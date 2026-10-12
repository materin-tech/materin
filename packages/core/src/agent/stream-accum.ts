import type { AssistantContentBlock, StreamEvent, ToolCallBlock, Usage } from '@materin/ai'

/**
 * Stream event accumulation: neutral StreamEvents -> one assistant message.
 */

export interface AccumState {
  content: AssistantContentBlock[]
  usage: Usage | undefined
  stopReason: string | undefined
}

export function createAccumState(): AccumState {
  return { content: [], usage: undefined, stopReason: undefined }
}

export function applyStreamEvent(accum: AccumState, ev: StreamEvent): void {
  if (ev.type === 'text_start') {
    accum.content.push({ type: 'text', text: '' })
    return
  }
  if (ev.type === 'text_delta') {
    const block = accum.content[ev.index]
    if (block?.type === 'text') block.text += ev.delta
    return
  }
  if (ev.type === 'thinking_delta') {
    accum.content.push({ type: 'thinking', thinking: ev.delta })
    return
  }
  if (ev.type === 'toolcall_start') {
    accum.content[ev.index] = { type: 'toolCall', id: ev.id, name: ev.name, arguments: '' } as unknown as ToolCallBlock
    return
  }
  if (ev.type === 'toolcall_delta') {
    const block = accum.content[ev.index] as unknown as { arguments: string }
    if (block && typeof block.arguments === 'string') block.arguments += ev.delta
    return
  }
  if (ev.type === 'toolcall_end') {
    const block = accum.content[ev.index]
    if (block?.type === 'toolCall' && typeof block.arguments === 'string') {
      const raw = block.arguments
      try {
        block.arguments = raw.trim() ? JSON.parse(raw) : {}
      } catch {
        block.arguments = { __invalid_json: raw }
      }
    }
    return
  }
  if (ev.type === 'done') {
    if (ev.usage) {
      accum.usage = {
        input: ev.usage.input,
        output: ev.usage.output,
        cacheRead: ev.usage.cacheRead,
        cacheWrite: ev.usage.cacheWrite,
      }
    }
    if (ev.stopReason) accum.stopReason = ev.stopReason
    return
  }
}

export function asUpdateDelta(ev: StreamEvent): { type: 'text' | 'thinking'; text: string } | null {
  if (ev.type === 'text_delta') return { type: 'text', text: ev.delta }
  if (ev.type === 'thinking_delta') return { type: 'thinking', text: ev.delta }
  return null
}
