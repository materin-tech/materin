import {
  compact,
  discoverSkills,
  extractPlainText,
  normalizeMode,
  VERSION,
  type LoadedExtensions,
  type MemoryStore,
  type SessionRow,
  type SessionStore,
  type ResolveProvider,
} from '@materin/core'
import type { Database } from 'bun:sqlite'
import { listAvailableModels, normalizeThinking, resolveModel } from '@materin/ai'
import { runTokenCommand } from './usage-format'
import type { Context } from 'hono'

/**
 * Slash-command registry: single source of truth for builtin commands
 * (specs power /help) + their handlers. Extension commands stay ahead
 * of builtins so they can override.
 */

export interface CommandSpec {
  name: string
  description: string
  usage?: string
}

export const BUILTIN_COMMANDS: CommandSpec[] = [
  { name: '/help', description: '显示全部命令说明', usage: '[cmd]' },
  { name: '/clear', description: '清空当前会话上下文 (新建等价会话)' },
  { name: '/new', description: '新建会话' },
  { name: '/compact', description: '压缩上下文', usage: '[focus]' },
  { name: '/model', description: '查看/切换模型', usage: '[opus|sonnet|haiku|deepseek|qwen|kimi|glm]' },
  { name: '/thinking', description: '查看/设置思考深度', usage: '[off|low|medium|high|xhigh]' },
  { name: '/mode', description: '查看/设置审批模式', usage: '[plan|manual|auto|passon]' },
  { name: '/plan', description: '快捷切换到 plan 模式' },
  { name: '/passon', description: '快捷切换到 passon 模式' },
  { name: '/status', description: '会话状态: model/thinking/mode/tokens/消息数' },
  { name: '/token', description: '查看模型调用 token 统计 (today|7d|30d|all, 默认当前会话)', usage: '[period]' },
  { name: '/skills', description: '列出已发现的 skills' },
  { name: '/memory', description: '显示当前项目记忆快照 (MEMORY.md)' },
  { name: '/search', description: '跨会话搜索', usage: '<query>' },
  { name: '/branch', description: '不带参列出最近消息, 带参切分支', usage: '[messageId]' },
  { name: '/extensions', description: '列出已加载扩展' },
  { name: '/version', description: '显示版本' },
  { name: '/exit', description: '退出 (客户端处理)' },
]

export interface CommandCtx {
  store: SessionStore
  resolveProvider: ResolveProvider
  getMemory?: (sessionId: string) => MemoryStore
  getExtensions?: () => LoadedExtensions | undefined
  getDb?: () => Database
}

export type CommandHandler = (c: Context, sessionId: string, arg?: string) => Promise<Response>
export type CommandRegistry = Map<string, { spec: CommandSpec; run: CommandHandler }>

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const BLANK_MODEL = 'claude-sonnet-5-5'

export function buildCommandRegistry(ctx: CommandCtx): CommandRegistry {
  const registry: CommandRegistry = new Map()
  const add = (spec: CommandSpec, run: CommandHandler): void => {
    registry.set(spec.name, { spec: spec, run: run })
  }
  const needSession = (c: Context, sessionId: string): SessionRow | null => ctx.store.getSession(sessionId)

  add({ name: '/help', description: BUILTIN_COMMANDS[0]!.description, usage: '[cmd]' }, async (c, _sid, arg) =>
    c.json({ command: true, output: formatHelp(ctx, arg) }),
  )
  add(
    { name: '/clear', description: BUILTIN_COMMANDS[1]!.description },
    async (c, sessionId) => {
      const session = needSession(c, sessionId)
      if (!session) return c.json({ error: 'not found' }, 404)
      const created = ctx.store.createSession({ cwd: session.cwd ?? process.cwd(), model: session.model ?? BLANK_MODEL })
      return c.json({ command: true, sessionId: created.id, output: '新会话 ' + created.id + ' (上下文已清空)' }, 201)
    },
  )
  add({ name: '/new', description: BUILTIN_COMMANDS[2]!.description }, async (c, sessionId) => {
    const session = ctx.store.getSession(sessionId)
    const created = ctx.store.createSession({ cwd: session?.cwd ?? process.cwd(), model: session?.model ?? BLANK_MODEL })
    return c.json({ command: true, sessionId: created.id, output: '新会话 ' + created.id }, 201)
  })
  add({ name: '/compact', description: BUILTIN_COMMANDS[3]!.description, usage: '[focus]' }, async (c, sessionId) => {
    const session = needSession(c, sessionId)
    if (!session) return c.json({ error: 'not found' }, 404)
    try {
      const result = await compact(ctx.store, ctx.resolveProvider, session.model ?? BLANK_MODEL, sessionId)
      if (result === null) return c.json({ command: true, error: 'nothing to compact' }, 400)
      return c.json({ command: true, summary: result.summary, tokensBefore: result.tokensBefore, output: '已压缩 (tokens: ' + result.tokensBefore + ')\n\n' + result.summary })
    } catch (e) {
      return c.json({ command: true, error: errText(e) }, 502)
    }
  })
  add({ name: '/model', description: BUILTIN_COMMANDS[4]!.description, usage: '[model]' }, async (c, _sid, arg) => {
    if (!arg) return c.json({ command: true, models: listAvailableModels() })
    const resolved = resolveModel(arg)
    ctx.store.setSessionModel(_sid, resolved.id)
    return c.json({ command: true, model: resolved.id, output: 'model: ' + resolved.id })
  })
  add({ name: '/thinking', description: BUILTIN_COMMANDS[5]!.description, usage: '[level]' }, async (c, sessionId, arg) => {
    const session = needSession(c, sessionId)
    if (!session) return c.json({ error: 'not found' }, 404)
    const raw = arg?.trim()
    if (!raw) return c.json({ command: true, output: 'usage: /thinking <off|low|medium|high|xhigh>' })
    const level = normalizeThinking(raw)
    if (level === 'off' && raw.toLowerCase() !== 'off') {
      return c.json({ command: true, output: 'usage: /thinking <off|low|medium|high|xhigh> (got: ' + raw + ')', error: 'invalid thinking level' })
    }
    ctx.store.setThinkingLevel(sessionId, level)
    return c.json({ command: true, thinkingLevel: level, session: ctx.store.getSession(sessionId), output: 'thinking: ' + level })
  })
  add({ name: '/mode', description: BUILTIN_COMMANDS[6]!.description, usage: '[mode]' }, async (c, sessionId, arg) => {
    const session = needSession(c, sessionId)
    if (!session) return c.json({ error: 'not found' }, 404)
    const raw = arg?.trim()
    if (!raw) return c.json({ command: true, output: 'usage: /mode <plan|manual|auto|passon> (current: ' + session.permissionMode + ')' })
    const mode = normalizeMode(raw)
    if (mode === 'manual' && raw.toLowerCase() !== 'manual') {
      return c.json({ command: true, output: 'usage: /mode <plan|manual|auto|passon> (got: ' + raw + ')', error: 'invalid mode' })
    }
    ctx.store.setPermissionMode(sessionId, mode)
    return c.json({ command: true, output: 'mode: ' + mode, session: ctx.store.getSession(sessionId) })
  })
  add({ name: '/plan', description: BUILTIN_COMMANDS[7]!.description }, async (c, sessionId) => {
    if (!ctx.store.getSession(sessionId)) return c.json({ error: 'not found' }, 404)
    ctx.store.setPermissionMode(sessionId, 'plan')
    return c.json({ command: true, output: 'mode: plan' })
  })
  add({ name: '/passon', description: BUILTIN_COMMANDS[8]!.description }, async (c, sessionId) => {
    if (!ctx.store.getSession(sessionId)) return c.json({ error: 'not found' }, 404)
    ctx.store.setPermissionMode(sessionId, 'passon')
    return c.json({ command: true, output: 'mode: passon' })
  })
  add({ name: '/status', description: BUILTIN_COMMANDS[9]!.description }, async (c, sessionId) => {
    const session = needSession(c, sessionId)
    if (!session) return c.json({ error: 'not found' }, 404)
    const chain = ctx.store.getMessagesToLeaf(sessionId)
    let tokensIn = 0
    let tokensOut = 0
    for (const m of chain) {
      if (m.usage) {
        tokensIn += m.usage.input
        tokensOut += m.usage.output
      }
    }
    const output = [
      'model: ' + (session.model ?? '-'),
      'thinking: ' + session.thinkingLevel,
      'mode: ' + session.permissionMode,
      'messages: ' + chain.length,
      'tokens: ' + tokensIn + ' in / ' + tokensOut + ' out',
      'cwd: ' + (session.cwd ?? '-'),
    ].join('\n')
    return c.json({ command: true, output: output })
  })
  add({ name: '/token', description: BUILTIN_COMMANDS[10]!.description, usage: '[period]' }, (c, sessionId, arg) =>
    runTokenCommand(ctx, c, sessionId, arg),
  )
  add({ name: '/skills', description: BUILTIN_COMMANDS[11]!.description }, async (c, sessionId) => {
    const session = needSession(c, sessionId)
    if (!session) return c.json({ error: 'not found' }, 404)
    const skills = discoverSkills(session.cwd ?? process.cwd())
    const output = skills.length === 0 ? '(no skills found)' : skills.map((s) => s.name + (s.description ? ' — ' + s.description : '')).join('\n')
    return c.json({ command: true, output: output })
  })
  add({ name: '/memory', description: BUILTIN_COMMANDS[12]!.description }, async (c, sessionId) => {
    const snapshot = ctx.getMemory?.(sessionId).readSnapshot() ?? ''
    return c.json({ command: true, output: snapshot.trim().length > 0 ? snapshot : '(empty)' })
  })
  add({ name: '/search', description: BUILTIN_COMMANDS[13]!.description, usage: '<query>' }, async (c, _sid, arg) => {
    const q = (arg ?? '').trim()
    if (q.length === 0) return c.json({ command: true, output: 'usage: /search <query>', error: 'query required' })
    const hits = ctx.store.search(q, 10)
    const output = hits.length === 0 ? '(无结果)' : hits.map((h) => '[' + h.sessionId + '] ' + h.snippet.replace(/\s+/g, ' ').trim()).join('\n')
    return c.json({ command: true, output: output })
  })
  add({ name: '/branch', description: BUILTIN_COMMANDS[14]!.description, usage: '[messageId]' }, async (c, sessionId, arg) => {
    const target = (arg ?? '').trim()
    if (!target) {
      const chain = ctx.store.getMessagesToLeaf(sessionId)
      const output =
        chain.length === 0
          ? '(no messages)'
          : chain
              .slice(-20)
              .map((m) => '[' + m.seq + '] ' + m.id + ' ' + m.role + ' ' + extractPlainText(m.content).replace(/\s+/g, ' ').trim().slice(0, 40))
              .join('\n')
      return c.json({ command: true, output: output })
    }
    try {
      ctx.store.branch(sessionId, target)
      return c.json({ command: true, output: 'branched to ' + target })
    } catch (e) {
      return c.json({ command: true, error: errText(e) }, 400)
    }
  })
  add({ name: '/extensions', description: BUILTIN_COMMANDS[15]!.description }, async (c) => {
    const ext = ctx.getExtensions?.()
    const commands = ext ? [...ext.commands.keys()] : []
    const tools = ext?.tools.length ?? 0
    const output = commands.length === 0 && tools === 0 ? '(none)' : 'tools: ' + tools + '\ncommands: ' + (commands.map((n) => '/' + n).join(', ') || '(none)')
    return c.json({ command: true, output: output })
  })
  add({ name: '/version', description: BUILTIN_COMMANDS[16]!.description }, async (c) =>
    c.json({ command: true, output: 'materin ' + VERSION }),
  )
  add({ name: '/exit', description: BUILTIN_COMMANDS[17]!.description }, async (c) =>
    c.json({ command: true, error: 'exit is handled by the client' }, 400),
  )
  return registry
}

/** /help output: one command per line; `/help <cmd>` shows a single spec; extension commands appended. */
function formatHelp(ctx: CommandCtx, arg?: string): string {
  const name = (arg ?? '').trim().replace(/^\//, '')
  if (name.length > 0) {
    const spec = BUILTIN_COMMANDS.find((s) => s.name === '/' + name)
    if (!spec) return 'unknown command: /' + name
    return spec.name + (spec.usage ? ' ' + spec.usage : '') + '\n  ' + spec.description
  }
  const lines = ['命令列表:', ...BUILTIN_COMMANDS.map((s) => s.name + (s.usage ? ' ' + s.usage : '') + '  ' + s.description)]
  const extCommands = [...(ctx.getExtensions?.()?.commands.keys() ?? [])]
  if (extCommands.length > 0) lines.push('', '扩展命令:', ...extCommands.map((n) => '/' + n + '  (extension)'))
  return lines.join('\n')
}
