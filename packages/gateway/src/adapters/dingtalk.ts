import type { ChannelAdapter, InboundMessage, OutboundMessage } from '../types'

/**
 * 钉钉适配器: dingtalk-stream SDK 长连接收消息, reply API 主动发消息.
 * sessionWebhook 是会话级临时回调 (仅当轮有效), 异步回复统一走 reply API.
 * 纯函数 dingtalkMessageToInbound 可脱离 SDK 测试.
 */

export interface DingtalkConfig {
  appKey: string
  appSecret: string
}

interface DingtalkMessageShape {
  text?: { content?: string }
  conversationId?: string
  conversationType?: string
  senderStaffId?: string
  senderId?: string
  sessionWebhook?: string
}

const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken'
const TOKEN_TTL_MARGIN_MS = 5 * 60 * 1000
const REPLY_API = 'https://api.dingtalk.com/v1.0/robot/'

/** PURE: map a dingtalk robot message to InboundMessage (null = ignore). */
export function dingtalkMessageToInbound(message: Record<string, unknown>): InboundMessage | null {
  const m = (message ?? {}) as DingtalkMessageShape
  const userId = m.senderStaffId ?? m.senderId
  if (!userId) return null
  let text = ''
  try {
    text = (m.text?.content ?? '').replace(/^@[^ ]+\s*/, '').trim()
  } catch {
    text = ''
  }
  if (text.length === 0) return null
  // conversationType '1' = 单聊 -> chatId 用 userId; 群聊 -> openConversationId
  const chatId = m.conversationType === '1' ? userId : m.conversationId
  if (!chatId) return null
  return { channel: 'dingtalk', chatId: chatId, userId: userId, text: text, raw: message }
}

interface TokenCache {
  token: string
  expiresAt: number
}

export class DingtalkAdapter implements ChannelAdapter {
  readonly id = 'dingtalk'
  private handler: ((msg: InboundMessage) => Promise<void>) | null = null
  private tokenCache: TokenCache | null = null
  private readonly conversationTypes = new Map<string, string>()

  constructor(private readonly config: DingtalkConfig) {}

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler
  }

  async start(): Promise<void> {
    if (this.config.appKey.length === 0 || this.config.appSecret.length === 0) {
      throw new Error(
        'DingTalk adapter requires DINGTALK_APP_KEY / DINGTALK_APP_SECRET. ' +
          'Create an enterprise internal app / robot at https://open-dev.dingtalk.com, ' +
          "enable the Stream mode callback and subscribe to '/v1.0/im/bot/messages/get'.",
      )
    }
    const mod = (await import('dingtalk-stream')) as unknown as {
      DWClient: new (opts: { clientId: string; clientSecret: string }) => {
        registerCallbackListener(topic: string, cb: (message: unknown) => Promise<unknown>): void
        connect(): Promise<unknown>
      }
    }
    const client = new mod.DWClient({ clientId: this.config.appKey, clientSecret: this.config.appSecret })
    client.registerCallbackListener('/v1.0/im/bot/messages/get', (message: unknown) => this.onMessageEvent(message))
    await client.connect()
  }

  async stop(): Promise<void> {
    // DWClient has no public close(); the process lifetime owns the connection
  }

  private async onMessageEvent(message: unknown): Promise<unknown> {
    const handler = this.handler
    if (!handler) return {}
    const record = (message ?? {}) as Record<string, unknown>
    const inbound = dingtalkMessageToInbound(record)
    if (!inbound) return {}
    this.conversationTypes.set(inbound.chatId, String((record as DingtalkMessageShape).conversationType ?? ''))
    await handler(inbound)
    return {}
  }

  async send(chatId: string, msg: OutboundMessage): Promise<void> {
    const token = await this.accessToken()
    // conversationType 是入站消息属性; 按 chatId 记录, send 时回查 ('1' = 单聊)
    const isGroup = this.conversationTypes.get(chatId) !== '1'
    const url = REPLY_API + (isGroup ? 'groupMessages/send' : 'oToMessages/batchSend')
    const body = isGroup
      ? { robotCode: this.config.appKey, openConversationId: chatId, msgKey: 'sampleText', content: { content: msg.text } }
      : { robotCode: this.config.appKey, userIds: [chatId], msgKey: 'sampleText', content: { content: msg.text } }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-acs-dingtalk-access-token': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('dingtalk reply api failed: ' + String(res.status) + ' ' + (await res.text()))
  }

  private async accessToken(): Promise<string> {
    const cached = this.tokenCache
    if (cached && Date.now() < cached.expiresAt) return cached.token
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appKey: this.config.appKey, appSecret: this.config.appSecret }),
    })
    const data = (await res.json()) as { accessToken?: string; expireIn?: number }
    if (!data.accessToken) throw new Error('dingtalk accessToken request failed: ' + JSON.stringify(data))
    this.tokenCache = {
      token: data.accessToken,
      expiresAt: Date.now() + Math.max((data.expireIn ?? 7200) * 1000 - TOKEN_TTL_MARGIN_MS, 60_000),
    }
    return data.accessToken
  }
}
