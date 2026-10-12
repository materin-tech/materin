import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * 企业微信回调加解密 (WeCom callback encryption scheme).
 * 明文结构: random(16B) + msg_len(4B, big-endian network order) + msg + receiveId
 * AES-256-CBC, key = base64(43字符 EncodingAESKey + '='), iv = key 前 16 字节, PKCS#7 (32B block).
 */

export function wecomSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  const parts = [token, timestamp, nonce, encrypt].sort()
  return createHash('sha1').update(parts.join('')).digest('hex')
}

export class WeComCrypto {
  private readonly key: Buffer
  private readonly iv: Buffer

  constructor(
    private readonly token: string,
    encodingAesKey: string,
  ) {
    if (encodingAesKey.length !== 43) throw new Error('WECOM_ENCODING_AES_KEY must be exactly 43 characters')
    this.key = Buffer.from(encodingAesKey + '=', 'base64')
    this.iv = this.key.subarray(0, 16)
  }

  verifySignature(timestamp: string, nonce: string, encrypt: string, signature: string): boolean {
    return wecomSignature(this.token, timestamp, nonce, encrypt) === signature
  }

  decrypt(encryptB64: string): { message: string; receiveId: string } {
    const decipher = createDecipheriv('aes-256-cbc', this.key, this.iv)
    decipher.setAutoPadding(false)
    const plain = Buffer.concat([decipher.update(Buffer.from(encryptB64, 'base64')), decipher.final()])
    const pad = plain[plain.length - 1] ?? 0
    const unpadded = plain.subarray(0, plain.length - pad)
    const msgLen = unpadded.readUInt32BE(16)
    const message = unpadded.subarray(20, 20 + msgLen).toString('utf-8')
    const receiveId = unpadded.subarray(20 + msgLen).toString('utf-8')
    return { message: message, receiveId: receiveId }
  }

  encrypt(plaintext: string, receiveId: string): string {
    const msg = Buffer.from(plaintext, 'utf-8')
    const len = Buffer.alloc(4)
    len.writeUInt32BE(msg.length, 0)
    const raw = Buffer.concat([randomBytes(16), len, msg, Buffer.from(receiveId, 'utf-8')])
    const blockSize = 32
    const padLen = blockSize - (raw.length % blockSize)
    const padded = Buffer.concat([raw, Buffer.alloc(padLen, padLen)])
    const cipher = createCipheriv('aes-256-cbc', this.key, this.iv)
    cipher.setAutoPadding(false)
    return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64')
  }
}
