import { describe, test, expect } from 'bun:test'
import { feishuEventToInbound } from '../src/adapters/feishu'

describe('feishuEventToInbound', () => {
  test('text event: strips @mention and maps chat/user ids', () => {
    const event = {
      message: { chat_id: 'oc_x', message_type: 'text', content: '{"text":"@bot 帮我看下这个"}' },
      sender: { sender_id: { open_id: 'ou_1' } },
    }
    const msg = feishuEventToInbound(event)
    expect(msg).not.toBeNull()
    expect(msg!.channel).toBe('feishu')
    expect(msg!.chatId).toBe('oc_x')
    expect(msg!.userId).toBe('ou_1')
    expect(msg!.text).toBe('帮我看下这个')
    expect(msg!.raw).toBe(event)
  })

  test('image event: maps to image placeholder for adapter download', () => {
    const event = {
      message: { chat_id: 'oc_x', message_type: 'image', content: '{"image_key":"img_v2_x"}' },
      sender: { sender_id: { open_id: 'ou_1' } },
    }
    const msg = feishuEventToInbound(event)
    expect(msg).not.toBeNull()
    expect(msg!.image?.mimeType).toBe('image/jpeg')
    expect(msg!.image?.data).toBe('')
    expect(msg!.text).toBeUndefined()
  })

  test('null on missing sender or unknown message type', () => {
    expect(feishuEventToInbound({ message: { chat_id: 'oc_x', message_type: 'text', content: '{"text":"hi"}' } })).toBeNull()
    expect(
      feishuEventToInbound({ message: { chat_id: 'oc_x', message_type: 'post', content: '{}' }, sender: { sender_id: { open_id: 'ou_1' } } }),
    ).toBeNull()
    expect(feishuEventToInbound(null)).toBeNull()
  })
})
