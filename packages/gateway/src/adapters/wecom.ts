import type { ChannelAdapter, InboundMessage, OutboundMessage } from '../types'
import { WeComCrypto } from '../wecom-crypto'
import { WecomApi } from './wecom-api'

/**
 * 企业微信自建应用适配器: Bun.serve 回调模式 (需要公网 https, 推荐 frp/ngrok).
 * GET 验证 URL, POST 收消息; 主动发消息走 message/send API.
 * 纯函数 wecomXmlToInbound 可脱离网络测试.
 */

export interface WecomConfig {
  corpId: string
  corpSecret: string
  agentId: number
  token: string
  encodingAesKey: string
  port: number
}

export interface WecomParsedXml {
  chatId: string
  userId: string
  text?: string
  msgType: string
  mediaId?: string
}

/** PURE: extract minimal fields from the (decrypted) inner WeCom XML. */
export function wecomXmlToInbound(xml: string): WecomParsedXml | null {
  const field = (tag: string): string => {
    const re = new RegExp('<' + tag + '>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</' + tag + '>')
    return xml.match(re)?.[1] ?? ''
  }
  const userId = field('FromUserName')
  if (userId.length === 0) return null
  const msgType = field('MsgType')
  const chatId = field('ChatId') || userId
  const parsed: WecomParsedXml = {
    chatId: chatId,
    userId: userId,
    text: msgType === 'text' ? field('Content') : undefined,
    msgType: msgType,
    mediaId: msgType === 'image' ? field('MediaId') : undefined,
  }
  return parsed
}

export class WecomAdapter implements ChannelAdapter {
  readonly id = 'wecom'
  private handler: ((msg: InboundMessage) => Promise<void>) | null = null
  private server: Bun.Server<never> | null = null
  private readonly crypto: WeComCrypto
  private readonly api: WecomApi

  constructor(private readonly config: WecomConfig) {
    this.crypto = new WeComCrypto(config.token, config.encodingAesKey)
    this.api = new WecomApi(config)
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler
  }

  async start(): Promise<void> {
    const needed = [this.config.corpId, this.config.corpSecret, this.config.token, this.config.encodingAesKey]
    if (needed.some((v) => v.length === 0) || this.config.agentId <= 0) {
      throw new Error(
        'WeCom adapter requires WECOM_CORP_ID / WECOM_CORP_SECRET / WECOM_AGENT_ID / WECOM_TOKEN / WECOM_ENCODING_AES_KEY. ' +
          'Create a self-built app at https://work.weixin.qq.com, set the callback URL (public https needed — use frp/ngrok), ' +
          'and grant the agent permission to receive messages.',
      )
    }
    this.server = Bun.serve({ port: this.config.port, hostname: '0.0.0.0', fetch: (req) => this.onRequest(req) })
  }

  async stop(): Promise<void> {
    this.server?.stop(true)
  }

  private async onRequest(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname !== '/wecom/callback') return new Response('not found', { status: 404 })
    const qs = url.searchParams
    const msgSignature = qs.get('msg_signature') ?? ''
    const timestamp = qs.get('timestamp') ?? ''
    const nonce = qs.get('nonce') ?? ''
    if (req.method === 'GET') return this.verifyUrl(qs.get('echostr') ?? '', msgSignature, timestamp, nonce)
    if (req.method === 'POST') return this.onPost(req, msgSignature, timestamp, nonce)
    return new Response('method not allowed', { status: 405 })
  }

  /** GET: verify signature over echostr, return the decrypted echo (plain text). */
  private verifyUrl(echostr: string, msgSignature: string, timestamp: string, nonce: string): Response {
    if (!this.crypto.verifySignature(timestamp, nonce, echostr, msgSignature)) {
      return new Response('bad signature', { status: 403 })
    }
    try {
      return new Response(this.crypto.decrypt(echostr).message)
    } catch {
      return new Response('decrypt failed', { status: 400 })
    }
  }

  private async onPost(req: Request, msgSignature: string, timestamp: string, nonce: string): Promise<Response> {
    const xml = await req.text()
    const encrypt = xml.match(/<Encrypt>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/Encrypt>/)?.[1] ?? ''
    if (encrypt.length === 0 || !this.crypto.verifySignature(timestamp, nonce, encrypt, msgSignature)) {
      return new Response('bad signature', { status: 403 })
    }
    let inner: string
    try {
      inner = this.crypto.decrypt(encrypt).message
    } catch {
      return new Response('decrypt failed', { status: 400 })
    }
    const parsed = wecomXmlToInbound(inner)
    if (parsed && this.handler) {
      const inbound = await this.buildInbound(parsed)
      // WeCom needs a fast 200; the agent turn runs after this response is sent
      void this.handler(inbound).catch(() => undefined)
    }
    return new Response('success')
  }

  private async buildInbound(parsed: WecomParsedXml): Promise<InboundMessage> {
    if (parsed.msgType === 'image' && parsed.mediaId) {
      const data = await this.api.downloadMedia(parsed.mediaId)
      if (data) {
        const inbound: InboundMessage = {
          channel: 'wecom',
          chatId: parsed.chatId,
          userId: parsed.userId,
          image: { mimeType: 'image/jpeg', data: data },
          raw: parsed,
        }
        return inbound
      }
    }
    const inbound: InboundMessage = {
      channel: 'wecom',
      chatId: parsed.chatId,
      userId: parsed.userId,
      text: parsed.text,
      raw: parsed,
    }
    return inbound
  }

  async send(chatId: string, msg: OutboundMessage): Promise<void> {
    await this.api.sendMessage(chatId, msg.text)
  }
}
