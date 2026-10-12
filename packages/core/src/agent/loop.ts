import { Value } from '@sinclair/typebox/value'
import { normalizeThinking, replayFilter } from '@materin/ai'
import type { ImageBlock, ModelInfo, StreamContext, ToolCallBlock, ToolDefinition, UserContentBlock } from '@materin/ai'
import { rowToAiMessage, type MessageRow, type SessionStore } from '../session/store'
import type { MemoryStore } from '../memory'
import type { Tool, ToolContext, ToolOutput } from '../tools/types'
import type { PermissionManager } from '../permissions'
import type { LoadedExtensions } from '../extensions'
import { collectRules } from '../rules'
import { discoverSkills, buildSkillsListing } from '../skills'
import { compact, type ResolveProvider } from './compaction'
import { SYSTEM_PROMPT } from './system-prompt'
import { normalizeMode, resolveToolDecision } from './modes'
import { applyStreamEvent, asUpdateDelta, createAccumState } from './stream-accum'

/**
 * Agent loop (Pi style): stream -> tool_use? -> execute -> append -> repeat.
 * M2: multi-provider resolution, rules injection, compaction preflight, permission gate.
 */

export type AgentEvent =
  | { type: 'agent_start'; sessionId: string }
  | { type: 'message_start'; sessionId: string }
  | { type: 'message_update'; sessionId: string; delta: { type: 'text' | 'thinking'; text: string } }
  | { type: 'message_end'; sessionId: string; messageId: string }
  | { type: 'tool_execution_start'; sessionId: string; callId: string; tool: string; argsPreview: string }
  | { type: 'tool_execution_end'; sessionId: string; callId: string; isError: boolean; preview: string }
  | { type: 'agent_end'; sessionId: string; stopReason: string }
  | { type: 'agent_error'; sessionId: string; error: string }
  | { type: 'permission_ask'; sessionId: string; callId: string; tool: string; args: unknown }

export interface AgentDeps {
  store: SessionStore
  resolveProvider: ResolveProvider
  getModelInfo: (model: string) => ModelInfo
  tools: Tool[]
  maxTokens?: number
  permissions?: PermissionManager
  memory?: MemoryStore
  onPermissionAsk?: (sessionId: string, tool: string, args: unknown) => Promise<boolean>
  extensions?: LoadedExtensions
  subagentDepth?: number
  maxSubagentDepth?: number
  skillsEnabled?: boolean
  skillsDirsOverride?: string[]
}

const CONTEXT_THRESHOLD = 0.85
const MAX_COMPACTION_ATTEMPTS = 3
const DEFAULT_MODEL = 'claude-sonnet-5-5'

export class AgentSession {
  constructor(
    private readonly sessionId: string,
    private readonly deps: AgentDeps,
  ) {}

  get id(): string {
    return this.sessionId
  }

  async *prompt(text: string, opts: { signal?: AbortSignal; images?: ImageBlock[] } = {}): AsyncGenerator<AgentEvent> {
    const sid = this.sessionId
    const { store } = this.deps
    const tools = [...this.deps.tools, ...(this.deps.extensions?.tools ?? [])]
    yield { type: 'agent_start', sessionId: sid }
    this.deps.extensions?.emit({ type: 'agent_start', sessionId: sid })

    const session = store.getSession(sid)
    if (!session) {
      const err = { type: 'agent_error', sessionId: sid, error: `session ${sid} not found` } as const
      this.deps.extensions?.emit(err)
      yield err
      return
    }

    let rulesText = collectRules(session.cwd ?? process.cwd())
    const skills = this.deps.skillsEnabled === false
      ? []
      : discoverSkills(session.cwd ?? process.cwd(), {
          globalDir: this.deps.skillsDirsOverride ? null : undefined,
          extraDirs: this.deps.skillsDirsOverride,
        })
    const skillsListing = buildSkillsListing(skills)
    if (skillsListing) rulesText = rulesText + '\n\n' + skillsListing
    const memoryText = this.deps.memory ? this.deps.memory.readSnapshot() : undefined
    const leaf = store.getLeaf(sid)
    const userContent: UserContentBlock[] = [...(opts.images ?? []), { type: 'text', text }]
    const userRow = store.appendMessage(sid, { role: 'user', content: userContent }, leaf ? leaf.id : null)
    store.setLeaf(sid, userRow.id)
    let parent: MessageRow = userRow

    try {
      while (true) {
        const sessionNow = store.getSession(sid) ?? session
        const model = sessionNow.model ?? DEFAULT_MODEL
        const resolved = this.deps.resolveProvider(model)
        await this.ensureContextBudget(sid, model, opts)

        const messages = replayFilter(store.buildContext(sid, rulesText, memoryText), resolved.api)
        const accum = createAccumState()
        yield { type: 'message_start', sessionId: sid }

        const ctx: StreamContext = {
          systemPrompt: SYSTEM_PROMPT,
          messages: messages,
          tools: tools.map(toDefinition),
          model: model,
          maxTokens: this.deps.maxTokens,
          thinkingLevel: normalizeThinking(sessionNow.thinkingLevel),
          signal: opts.signal,
        }

        let aborted = false
        try {
          for await (const ev of resolved.provider.stream(ctx)) {
            applyStreamEvent(accum, ev)
            const delta = asUpdateDelta(ev)
            if (delta) yield { type: 'message_update', sessionId: sid, delta: delta }
          }
        } catch (e) {
          if (opts.signal ? opts.signal.aborted : false) {
            aborted = true
          } else {
            throw e
          }
        }

        // 防御: 部分 Anthropic 兼容端点 (如 MiniMax) 缺发 content_block_stop,
        // 工具参数停留在原始字符串 — 流结束后强制 finalize
        for (const block of accum.content) {
          if (block.type === 'toolCall' && typeof block.arguments === 'string') {
            const raw = block.arguments
            try {
              block.arguments = raw.trim() ? JSON.parse(raw) : {}
            } catch {
              block.arguments = { __invalid_json: raw }
            }
          }
        }

        if (accum.usage) store.addSessionUsage(sid, accum.usage, model)
        const assistantRow = store.appendMessage(
          sid,
          {
            role: 'assistant',
            content: accum.content,
            model: model,
            provider: resolved.api,
            usage: accum.usage,
            stopReason: aborted ? 'aborted' : accum.stopReason,
          },
          parent.id,
        )
        store.setLeaf(sid, assistantRow.id)
        parent = assistantRow
        yield { type: 'message_end', sessionId: sid, messageId: assistantRow.id }
        this.deps.extensions?.emit({ type: 'message_end', sessionId: sid, messageId: assistantRow.id })

        if (aborted) {
          const end = { type: 'agent_end', sessionId: sid, stopReason: 'aborted' } as const
          this.deps.extensions?.emit(end)
          yield end
          return
        }

        const calls = accum.content.filter((b): b is ToolCallBlock => b.type === 'toolCall')
        if (calls.length === 0) {
          const end = { type: 'agent_end', sessionId: sid, stopReason: accum.stopReason ?? 'stop' } as const
          this.deps.extensions?.emit(end)
          yield end
          return
        }

        const toolCtx: ToolContext = {
          cwd: session.cwd ?? process.cwd(),
          signal: opts.signal,
          subagentDepth: this.deps.subagentDepth ?? 0,
          parentSessionId: sid,
        }
        for (const call of calls) {
          yield {
            type: 'tool_execution_start',
            sessionId: sid,
            callId: call.id,
            tool: call.name,
            argsPreview: previewArgs(call.arguments),
          }
          this.deps.extensions?.emit({
            type: 'tool_execution_start',
            sessionId: sid,
            callId: call.id,
            tool: call.name,
            argsPreview: previewArgs(call.arguments),
          })
          const blocked = await this.permissionGate(call)
          const extBlock = blocked === null ? this.deps.extensions?.intercept(call.name, call.arguments) ?? null : null
          let result: ToolOutput
          if (blocked !== null) {
            result = blocked
          } else if (extBlock !== null && extBlock.block) {
            result = { content: 'Blocked by extension: ' + (extBlock.reason ?? 'no reason'), isError: true }
          } else {
            result = await executeCall(call, tools, toolCtx)
          }
          const endEv = {
            type: 'tool_execution_end',
            sessionId: sid,
            callId: call.id,
            isError: result.isError ? true : false,
            preview: result.content.slice(0, 200),
          } as const
          yield endEv
          this.deps.extensions?.emit(endEv)
          const trRow = store.appendMessage(
            sid,
            {
              role: 'toolResult',
              content: [
                {
                  type: 'toolResult',
                  id: call.id,
                  name: call.name,
                  content: [{ type: 'text', text: result.content }],
                  isError: result.isError,
                  details: result.details,
                },
              ],
            },
            assistantRow.id,
          )
          store.setLeaf(sid, trRow.id)
          parent = trRow
        }
      }
    } catch (e) {
      yield { type: 'agent_error', sessionId: sid, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private async ensureContextBudget(sessionId: string, model: string, opts: { signal?: AbortSignal }): Promise<void> {
    const window = this.deps.getModelInfo(model).contextWindow
    let estimate = latestInputTokens(this.deps.store.getMessagesToLeaf(sessionId))
    let attempts = 0
    while (estimate > CONTEXT_THRESHOLD * window && attempts < MAX_COMPACTION_ATTEMPTS) {
      const result = await compact(this.deps.store, this.deps.resolveProvider, model, sessionId)
      if (result === null) break
      attempts += 1
      estimate = roughContextTokens(this.deps.store.buildContext(sessionId, ''))
    }
    if (estimate > CONTEXT_THRESHOLD * window) {
      throw new Error(
        'Context is still over ' +
          Math.round(CONTEXT_THRESHOLD * 100) +
          '% of the model window after ' +
          MAX_COMPACTION_ATTEMPTS +
          ' compaction attempts.',
      )
    }
  }

  private async permissionGate(call: ToolCallBlock): Promise<ToolOutput | null> {
    const perms = this.deps.permissions
    if (!perms) return null
    perms.record(call.name, call.arguments)
    const ruleDecision = perms.check(call.name, call.arguments)
    const sessionNow = this.deps.store.getSession(this.sessionId)
    const mode = normalizeMode(sessionNow?.permissionMode)
    const final = resolveToolDecision(mode, call.name, ruleDecision)
    if (final === 'allow') return null
    if (final === 'deny') {
      return blockedResult(mode === 'plan' && (call.name === 'edit' || call.name === 'write') ? 'plan mode is read-only' : 'blocked by permission rule')
    }
    const ask = this.deps.onPermissionAsk
    if (!ask) return blockedResult('blocked by permission rule')
    const allowed = await ask(this.sessionId, call.name, call.arguments)
    if (!allowed) return blockedResult('blocked by permission rule')
    return null
  }
}

function blockedResult(reason: string): ToolOutput {
  return { content: reason, isError: true }
}

function latestInputTokens(chain: MessageRow[]): number {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const row = chain[i]
    if (row && row.role === 'assistant' && row.usage) return row.usage.input
  }
  return 0
}

function roughContextTokens(messages: import('@materin/ai').Message[]): number {
  let chars = 0
  for (const m of messages) chars += JSON.stringify(m.content).length
  return Math.ceil(chars / 4)
}

function toDefinition(tool: Tool): ToolDefinition {
  return { name: tool.name, description: tool.description, parameters: tool.parameters }
}

async function executeCall(call: ToolCallBlock, tools: Tool[], ctx: ToolContext): Promise<ToolOutput> {
  const tool = tools.find((t) => t.name === call.name)
  if (!tool) return { content: `Unknown tool: ${call.name}`, isError: true }

  const args = call.arguments
  if (args !== null && typeof args === 'object' && '__invalid_json' in (args as Record<string, unknown>)) {
    return { content: 'Tool arguments were not valid JSON. Retry with well-formed JSON arguments.', isError: true }
  }
  if (!Value.Check(tool.parameters, args)) {
    const errors = [...Value.Errors(tool.parameters, args)].map((e) => `${e.path}: ${e.message}`).join('; ')
    return { content: `Invalid arguments for ${call.name}: ${errors}`, isError: true }
  }
  try {
    return await tool.execute(args as never, ctx)
  } catch (e) {
    if (ctx.signal ? ctx.signal.aborted : false) return { content: 'Tool execution aborted.', isError: true }
    return { content: `Tool ${call.name} failed: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
}

function previewArgs(args: unknown): string {
  try {
    const s = JSON.stringify(args)
    return s.length > 120 ? s.slice(0, 120) + '…' : s
  } catch {
    return '(unserializable args)'
  }
}

