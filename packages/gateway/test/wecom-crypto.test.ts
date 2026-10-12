import { describe, test, expect } from 'bun:test'
import { WeComCrypto, wecomSignature } from '../src/wecom-crypto'

const KEY43 = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopq'

describe('WeComCrypto', () => {
  test('encrypt -> decrypt roundtrip restores message and receiveId', () => {
    const crypto = new WeComCrypto('token123', KEY43)
    const encryptB64 = crypto.encrypt('帮我看看构建日志', 'wwcorp123')
    const decrypted = crypto.decrypt(encryptB64)
    expect(decrypted.message).toBe('帮我看看构建日志')
    expect(decrypted.receiveId).toBe('wwcorp123')
  })

  test('msg_len (4 bytes big-endian) extracts exactly the message bytes', () => {
    const crypto = new WeComCrypto('token123', KEY43)
    const decrypted = crypto.decrypt(crypto.encrypt('abc', 'receive-id'))
    expect(decrypted.message).toBe('abc')
    expect(decrypted.receiveId).toBe('receive-id')
  })

  test('verifySignature accepts the matching sha1 sort-join signature', () => {
    const crypto = new WeComCrypto('token123', KEY43)
    const sig = wecomSignature('token123', '1409659813', 'nonce', 'ENCRYPTED')
    expect(crypto.verifySignature('1409659813', 'nonce', 'ENCRYPTED', sig)).toBe(true)
  })

  test('verifySignature rejects a wrong signature / wrong params', () => {
    const crypto = new WeComCrypto('token123', KEY43)
    expect(crypto.verifySignature('1409659813', 'nonce', 'ENCRYPTED', 'deadbeef')).toBe(false)
    const sig = wecomSignature('token123', '1409659813', 'nonce', 'ENCRYPTED')
    expect(crypto.verifySignature('999', 'nonce', 'ENCRYPTED', sig)).toBe(false)
  })

  test('rejects a malformed EncodingAESKey', () => {
    expect(() => new WeComCrypto('t', 'short')).toThrow(/43 characters/)
  })
})
