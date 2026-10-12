import { describe, test, expect } from 'bun:test'
import { mapMessages } from '../src/openai-mapping'
import type { Message } from '../src/types'

function textUser(text: string): Message {
  return { role: 'user', content: [{ type: 'text', text: text }] }
}

describe('openai mapping', () => {
  test('system prompt and user text map to string content', () => {
    const wire = mapMessages('sys', [textUser('hi')])
    expect(wire).toHaveLength(2)
    expect(wire[0]).toEqual({ role: 'system', content: 'sys' })
    expect(wire[1]).toEqual({ role: 'user', content: 'hi' })
  })

  test('image blocks produce image_url parts', () => {
    const messages: Message[] = [
      { role: 'user', content: [
        { type: 'image', mimeType: 'image/png', data: 'B64' },
        { type: 'text', text: 'describe' },
      ] },
    ]
    const wire = mapMessages('', messages)
    const content = wire[0]!.content as Array<Record<string, unknown>>
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,B64' } })
    expect(content[1]).toEqual({ type: 'text', text: 'describe' })
  })

  test('tool call blocks map to tool_calls and tool results map to tool role', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [
        { type: 'text', text: 'using tool' },
        { type: 'toolCall', id: 'c1', name: 'read', arguments: { a: 1 } },
      ] },
      { role: 'toolResult', content: [
        { type: 'toolResult', id: 'c1', name: 'read', content: [{ type: 'text', text: 'file body' }] },
      ] },
    ]
    const wire = mapMessages('', messages)
    const assistant = wire[1] as Record<string, unknown>
    const tool = wire[2] as Record<string, unknown>
    expect(assistant.tool_calls).toHaveLength(1)
    expect(tool).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'file body' })
  })

  test('consecutive user messages merge; thinking-only assistants are skipped', () => {
    const messages: Message[] = [
      textUser('one'),
      textUser('two'),
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal' }] },
      textUser('three'),
    ]
    const wire = mapMessages('', messages)
    const merged = wire[0] as Record<string, unknown>
    expect(merged.content).toBe('one\ntwo\nthree')
  })
  test('assistant messages with calls keep tool_calls after merge', () => {
    const messages: Message[] = [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'read', arguments: {} }] },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'c2', name: 'read', arguments: {} }] },
    ]
    const wire = mapMessages('', messages)
    expect(wire).toHaveLength(1)
    expect((wire[0] as Record<string, unknown>).tool_calls).toHaveLength(2)
  })
})
