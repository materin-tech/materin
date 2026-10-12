import { describe, test, expect } from 'bun:test'
import { dingtalkMessageToInbound } from '../src/adapters/dingtalk'

describe('dingtalkMessageToInbound', () => {
  test('group message: conversationId as chatId, strips @mention', () => {
    const message = {
      text: { content: '@bot hi' },
      conversationId: 'cid_x',
      conversationType: '2',
      senderStaffId: 'u1',
      sessionWebhook: 'https://oapi.dingtalk.com/robot/send?access_token=abc',
    }
    const msg = dingtalkMessageToInbound(message)
    expect(msg).not.toBeNull()
    expect(msg!.chatId).toBe('cid_x')
    expect(msg!.userId).toBe('u1')
    expect(msg!.text).toBe('hi')
    expect(msg!.raw).toBe(message)
  })

  test('single chat (conversationType 1): chatId = senderStaffId', () => {
    const message = { text: { content: 'hello' }, conversationType: '1', senderStaffId: 'u1' }
    const msg = dingtalkMessageToInbound(message)
    expect(msg!.chatId).toBe('u1')
    expect(msg!.userId).toBe('u1')
  })

  test('null on missing sender or empty text', () => {
    expect(dingtalkMessageToInbound({ text: { content: 'hi' } })).toBeNull()
    expect(dingtalkMessageToInbound({ senderStaffId: 'u1', text: { content: '  ' } })).toBeNull()
  })
})
