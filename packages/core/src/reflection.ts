import type { MemoryOperation, MemoryStore } from './memory'
import { rowToAiMessage, type SessionStore } from './session/store'
import type { ResolveProvider } from './agent/compaction'

/**
 * 反思层 (M5): 每轮结束后一次廉价 LLM 调用抽取持久事实 -> memory.apply.
 * 绝不 throw (反思失败不能打断主流程); 默认关闭, MATERIN_REFLECTION=1 开启.
 */

export const REFLECTION_PROMPT = [
  'You extract durable memory from the conversation. Reply with a JSON array ONLY.',
  'Each item: {"action":"add"|"replace"|"remove", "find"?: string, "text"?: string}',
  '- "add" for durable user/project facts worth remembering across sessions.',
  '- Empty array [] when nothing durable appeared.',
  'Do not include transient details (what you just did, file states, greetings).',
].join('\n')

const MAX_TOKENS = 500
const DEFAULT_MAX_INPUT_MESSAGES = 30

export interface ReflectionResult {
  applied: boolean
  reason?: string
}

export async function reflectAfterTurn(deps: {
  store: SessionStore
  memory: MemoryStore
  resolveProvider: ResolveProvider
  model: string
  sessionId: string
  maxInputMessages?: number
}): Promise<ReflectionResult> {
  try {
    const chain = deps.store.getMessagesToLeaf(deps.sessionId)
    if (chain.length === 0) return { applied: false, reason: 'no messages' }
    const max = deps.maxInputMessages ?? DEFAULT_MAX_INPUT_MESSAGES
    const messages = chain.slice(-max).map((row) => rowToAiMessage(row))

    const { provider } = deps.resolveProvider(deps.model)
    let text = ''
    for await (const ev of provider.stream({
      systemPrompt: REFLECTION_PROMPT,
      messages: messages,
      tools: [],
      model: deps.model,
      maxTokens: MAX_TOKENS,
    })) {
      if (ev.type === 'text_delta') text += ev.delta
      else if (ev.type === 'error') return { applied: false, reason: 'provider error' }
    }

    const parsed = JSON.parse(stripFences(text)) as unknown
    if (!Array.isArray(parsed)) return { applied: false, reason: 'reflection output is not a JSON array' }

    const ops: MemoryOperation[] = []
    for (const raw of parsed) {
      const op = (raw as { action?: unknown; find?: unknown; text?: unknown })
      if (op.action !== 'add' && op.action !== 'replace' && op.action !== 'remove') {
        return { applied: false, reason: 'invalid memory action: ' + String(op.action) }
      }
      ops.push({
        action: op.action,
        find: typeof op.find === 'string' ? op.find : undefined,
        text: typeof op.text === 'string' ? op.text : undefined,
      })
    }

    const result = await deps.memory.apply(ops)
    if (!result.ok) {
      return {
        applied: false,
        reason:
          typeof result.overBy === 'number'
            ? 'MEMORY.md over limit by ' + result.overBy + ' chars'
            : (result.error ?? 'memory apply failed')
      }
    }
    return { applied: true }
  } catch (e) {
    return { applied: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('```')) {
    const first = trimmed.indexOf('\n')
    const last = trimmed.lastIndexOf('```')
    if (first >= 0 && last > first) return trimmed.slice(first + 1, last).trim()
  }
  return trimmed
}
