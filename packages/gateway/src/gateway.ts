import type { ModelInfo, Provider, ImageBlock } from '@materin/ai'
import type { SessionStore, Tool, PermissionManager, LoadedExtensions, MemoryStore } from '@materin/core'
import { AgentSession, reflectAfterTurn } from '@materin/core'
import type { ChannelAdapter, InboundMessage } from './types'

/**
 * Gateway: 渠道网关 (飞书/钉钉/企微/console).
 * 入站 -> gateway_routing 路由 -> per-session 串行队列 -> AgentSession.prompt -> 非流式回复.
 * 它是 SSE 总线的另一个消费者 + 入站推送者, 不是新的大脑.
 */

export interface GatewayDeps {
  store: SessionStore
  resolveProvider: (model: string) => { provider: Provider; api: 'anthropic' | 'openai-completions' }
  getModelInfo: (model: string) => ModelInfo
  permissions?: PermissionManager
  tools: Tool[]
  ackText?: string
  extensions?: LoadedExtensions
  /** per-session memory store; enables reflection when MATERIN_REFLECTION=1 */
  memoryFor?: (sessionId: string) => MemoryStore | undefined
}

const COMMAND_PREFIX = '/'
const MAX_REPLY_CHARS = 4000
const DEFAULT_GW_MODEL = process.env.MATERIN_MODEL ?? 'claude-sonnet-5-5'
const QUEUED_TEXT = '(queued, will process after current task)'
const COMMAND_TEXT = 'commands are not supported over channels yet'

export class Gateway {
  private readonly deps: GatewayDeps
  private readonly adapters: ChannelAdapter[] = []
  private readonly locks = new Map<string, { busy: boolean; queue: InboundMessage[] }>()

  constructor(deps: GatewayDeps) {
    this.deps = deps
  }

  /** register the adapter and wire its inbound handler (start() starts all adapters). */
  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.push(adapter)
    adapter.onMessage((msg) => this.handleInbound(adapter, msg).catch(reportInboundError))
  }

  /** start all registered adapters (called once by the binary after registration). */
  async start(): Promise<void> {
    for (const adapter of this.adapters) await adapter.start()
  }

  async stop(): Promise<void> {
    for (const adapter of this.adapters) await adapter.stop()
  }

  /** route -> queue (per-session serial) -> run one agent turn. */
  private async handleInbound(adapter: ChannelAdapter, msg: InboundMessage): Promise<void> {
    const sessionId = this.resolveSession(adapter, msg)
    const lock = this.locks.get(sessionId) ?? { busy: false, queue: [] }
    this.locks.set(sessionId, lock)

    if (lock.busy) {
      lock.queue.push(msg)
      await trySend(adapter, msg.chatId, QUEUED_TEXT)
      return
    }

    lock.busy = true
    try {
      await this.turn(adapter, msg, sessionId)
      // drain queued messages serially on the same session
      while (lock.queue.length > 0) {
        const next = lock.queue.shift()
        if (next) await this.turn(adapter, next, sessionId)
      }
    } finally {
      lock.busy = false
      if (lock.queue.length === 0) this.locks.delete(sessionId)
    }
  }

  /** one full agent turn: ack -> command guard -> prompt -> reply. */
  private async turn(adapter: ChannelAdapter, msg: InboundMessage, sessionId: string): Promise<void> {
    const { store } = this.deps
    const ack = this.deps.ackText ?? 'Received, working on it...'
    await trySend(adapter, msg.chatId, ack)

    const text = msg.text ?? ''
    if (text.startsWith(COMMAND_PREFIX)) {
      await trySend(adapter, msg.chatId, COMMAND_TEXT)
      return
    }

    const images: ImageBlock[] = msg.image ? [{ type: 'image', mimeType: msg.image.mimeType, data: msg.image.data }] : []
    const agent = new AgentSession(sessionId, {
      store: store,
      resolveProvider: this.deps.resolveProvider,
      getModelInfo: this.deps.getModelInfo,
      tools: this.deps.tools,
      permissions: this.deps.permissions,
      extensions: this.deps.extensions,
    })
    let reply = ''
    let error: string | null = null
    for await (const ev of agent.prompt(text, { images: images })) {
      if (ev.type === 'message_update' && ev.delta.type === 'text') reply += ev.delta.text
      else if (ev.type === 'agent_error') error = ev.error
    }
    if (error !== null) {
      await trySend(adapter, msg.chatId, 'Error: ' + error)
      return
    }
    await trySend(adapter, msg.chatId, truncate(reply.length > 0 ? reply : '(no response)'))
    await this.reflect(sessionId)
  }

  /** look up gateway_routing, create + persist the session on first message. */
  private resolveSession(adapter: ChannelAdapter, msg: InboundMessage): string {
    const { store } = this.deps
    const existing = store.getRoutingSession(msg.channel, msg.chatId, msg.userId)
    if (existing) return existing
    const session = store.createSession({
      cwd: '/',
      model: DEFAULT_GW_MODEL,
      source: 'gateway-' + adapter.id,
      title: adapter.id + ':' + msg.chatId,
    })
    store.setRoutingSession(msg.channel, msg.chatId, msg.userId, session.id)
    return session.id
  }

  /** reflection after a completed turn (M5, opt-in via MATERIN_REFLECTION=1). */
  private async reflect(sessionId: string): Promise<void> {
    if (process.env.MATERIN_REFLECTION !== '1') return
    const memory = this.deps.memoryFor?.(sessionId)
    if (!memory) return
    const session = this.deps.store.getSession(sessionId)
    const model = process.env.MATERIN_REFLECTION_MODEL ?? session?.model ?? DEFAULT_GW_MODEL
    await reflectAfterTurn({
      store: this.deps.store,
      memory: memory,
      resolveProvider: this.deps.resolveProvider,
      model: model,
      sessionId: sessionId,
    })
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_REPLY_CHARS) return text
  return text.slice(0, MAX_REPLY_CHARS) + ' (truncated)'
}

async function trySend(adapter: ChannelAdapter, chatId: string, text: string): Promise<void> {
  try {
    await adapter.send(chatId, { text: text })
  } catch (e) {
    process.stderr.write('[gateway] send failed: ' + (e instanceof Error ? e.message : String(e)) + '\n')
  }
}

function reportInboundError(e: unknown): void {
  process.stderr.write('[gateway] inbound error: ' + (e instanceof Error ? e.message : String(e)) + '\n')
}
