/**
 * Gateway 类型: 入站消息 / 出站消息 / 渠道适配器接口.
 * Gateway 是 SSE 总线的另一个消费者 + 入站推送者, 不是新的大脑.
 */

export interface InboundMessage {
  channel: string
  chatId: string
  userId: string
  text?: string
  image?: { mimeType: string; data: string }
  raw: unknown
}

export interface OutboundMessage {
  text: string
}

export interface ChannelAdapter {
  readonly id: string
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (msg: InboundMessage) => Promise<void>): void
  send(chatId: string, msg: OutboundMessage): Promise<void>
}
