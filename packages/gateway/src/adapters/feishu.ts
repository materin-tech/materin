import type { ChannelAdapter, InboundMessage, OutboundMessage } from '../types'

/**
 * 飞书适配器: @larksuiteoapi/node-sdk WSClient 长连接 (无需公网 IP).
 * 纯函数 feishuEventToInbound 可脱离 SDK 测试.
 */

export interface FeishuConfig {
  appId: string
  appSecret: string
}

interface FeishuEventShape {
  message?: {
    message_id?: string
    chat_id?: string
    message_type?: string
    content?: string
  }
  sender?: {
    sender_id?: { open_id?: string; user_id?: string }
  }
}

interface FeishuClient {
  im: {
    message: {
      create(opts: { params: { receive_id_type: string }; data: { receive_id: string; msg_type: string; content: string } }): Promise<unknown>
    }
  }
}

const IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** PURE: map a Feishu im.message.receive_v1 event to InboundMessage (null = ignore). */
export function feishuEventToInbound(event: unknown): InboundMessage | null {
  const e = (event ?? {}) as FeishuEventShape
  const msg = e.message
  const userId = e.sender?.sender_id?.open_id ?? e.sender?.sender_id?.user_id
  if (!msg?.chat_id || !userId) return null
  const base = { channel: 'feishu', chatId: msg.chat_id, userId: userId, raw: event }
  if (msg.message_type === 'text') {
    let text = ''
    try {
      text = (JSON.parse(msg.content ?? '{}') as { text?: string }).text ?? ''
    } catch {
      text = ''
    }
    text = text.replace(/^@[^ ]+\s*/, '').trim()
    if (text.length === 0) return null
    return { ...base, text: text }
  }
  if (msg.message_type === 'image') {
    // image bytes are downloaded by the adapter (needs SDK client); data starts empty
    return { ...base, text: undefined, image: { mimeType: 'image/jpeg', data: '' } }
  }
  return null
}

export class FeishuAdapter implements ChannelAdapter {
  readonly id = 'feishu'
  private handler: ((msg: InboundMessage) => Promise<void>) | null = null
  private client: FeishuClient | null = null
  private ws: { start: (opts: { eventDispatcher: unknown }) => Promise<void>; stop?: () => void } | null = null

  constructor(private readonly config: FeishuConfig) {}

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler
  }

  async start(): Promise<void> {
    if (this.config.appId.length === 0 || this.config.appSecret.length === 0) {
      throw new Error(
        'Feishu adapter requires FEISHU_APP_ID / FEISHU_APP_SECRET. ' +
          'Create an app at https://open.feishu.cn, add bot capability, ' +
          "subscribe to the 'im.message.receive_v1' event (use long-connection mode, no public IP needed).",
      )
    }
    const lark = await import('@larksuiteoapi/node-sdk')
    const client = new lark.Client({ appId: this.config.appId, appSecret: this.config.appSecret })
    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': (data: unknown) => this.onEvent(data),
    })
    const ws = new lark.WSClient({ appId: this.config.appId, appSecret: this.config.appSecret })
    this.client = client as unknown as FeishuClient
    this.ws = ws as unknown as { start: (opts: { eventDispatcher: unknown }) => Promise<void> }
    await this.ws.start({ eventDispatcher: dispatcher })
  }

  async stop(): Promise<void> {
    // WSClient has no public stop(); the process lifetime owns the connection
  }

  async send(chatId: string, msg: OutboundMessage): Promise<void> {
    if (!this.client) throw new Error('feishu adapter not started')
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: msg.text }) },
    })
  }

  private async onEvent(data: unknown): Promise<void> {
    const handler = this.handler
    if (!handler) return
    const inbound = feishuEventToInbound(data)
    if (!inbound) return
    if (inbound.image && inbound.image.data.length === 0) {
      const downloaded = await this.downloadImage(data)
      if (downloaded) inbound.image = downloaded
      else {
        inbound.image = undefined
        inbound.text = '(image download failed)'
      }
    }
    await handler(inbound)
  }

  /** im.messageResource.get -> stream -> Buffer -> base64; null on any failure (5MB cap). */
  private async downloadImage(data: unknown): Promise<{ mimeType: string; data: string } | null> {
    try {
      const e = (data ?? {}) as FeishuEventShape & { message?: { message_id?: string } }
      const messageId = e.message?.message_id
      const content = e.message?.content ?? '{}'
      let imageKey = ''
      try {
        imageKey = (JSON.parse(content) as { image_key?: string }).image_key ?? ''
      } catch {
        imageKey = ''
      }
      if (!messageId || imageKey.length === 0 || !this.client) return null
      const rawClient = this.client as unknown as {
        im: { messageResource: { get(opts: Record<string, unknown>): Promise<{ data: NodeJS.ReadableStream }> } }
      }
      const res = await rawClient.im.messageResource.get({
        path: { message_id: messageId },
        params: { file_key: imageKey },
        type: 'file',
      })
      const chunks: Buffer[] = []
      for await (const chunk of res.data) chunks.push(Buffer.from(chunk as Buffer))
      const buf = Buffer.concat(chunks)
      if (buf.length === 0 || buf.length > IMAGE_MAX_BYTES) return null
      return { mimeType: 'image/jpeg', data: buf.toString('base64') }
    } catch {
      return null
    }
  }
}
