import type { WecomConfig } from './wecom'

const QYAPI = 'https://qyapi.weixin.qq.com/cgi-bin/'
const TOKEN_TTL_MARGIN_MS = 5 * 60 * 1000
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024

/**
 * 企业微信被动 API 封装: access_token 缓存 / message/send / media/get.
 */
export class WecomApi {
  private tokenCache: { token: string; expiresAt: number } | null = null

  constructor(private readonly config: WecomConfig) {}

  async token(): Promise<string> {
    const cached = this.tokenCache
    if (cached && Date.now() < cached.expiresAt) return cached.token
    const url = QYAPI + 'gettoken?corpid=' + encodeURIComponent(this.config.corpId) + '&corpsecret=' + encodeURIComponent(this.config.corpSecret)
    const res = await fetch(url)
    const data = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!data.access_token) throw new Error('wecom gettoken failed: ' + JSON.stringify(data))
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max((data.expires_in ?? 7200) * 1000 - TOKEN_TTL_MARGIN_MS, 60_000),
    }
    return data.access_token
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const token = await this.token()
    // 群聊 chatid 以 wr 开头; 其余视为成员 userid -> touser
    const isGroup = chatId.startsWith('wr')
    const target: { chatid?: string; touser?: string } = isGroup ? { chatid: chatId } : { touser: chatId }
    const body = { ...target, msgtype: 'text', agentid: this.config.agentId, text: { content: text } }
    const res = await fetch(QYAPI + 'message/send?access_token=' + token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { errcode?: number; errmsg?: string }
    if ((data.errcode ?? 0) !== 0) throw new Error('wecom message/send failed: ' + JSON.stringify(data))
  }

  /** media/get -> base64 (null on empty/oversize). */
  async downloadMedia(mediaId: string): Promise<string | null> {
    try {
      const token = await this.token()
      const res = await fetch(QYAPI + 'media/get?access_token=' + token + '&media_id=' + encodeURIComponent(mediaId))
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0 || buf.length > IMAGE_MAX_BYTES) return null
      return buf.toString('base64')
    } catch {
      return null
    }
  }
}
