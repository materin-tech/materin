import type { StreamEvent } from './types'

/**
 * SSE parsing for OpenAI chat.completion.chunk payloads.
 * Streams neutral StreamEvents and accumulates usage / stop reason.
 */

interface ToolAccum {
  id: string
  name: string
  args: string
  index: number
}

function stopReasonMap(reason: string): string | undefined {
  if (reason === 'tool_calls') return 'toolUse'
  if (reason === 'length') return 'length'
  if (reason === 'stop') return 'stop'
  return undefined
}

export async function* parseOpenAiSse(body: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let started = false
  let textIndex = 0
  const toolAcc = new Map<number, ToolAccum>()
  let usage: { input: number; output: number } | undefined
  let stopReason: string | undefined

  function handleChunk(chunk: Record<string, unknown>): StreamEvent[] {
    const events: StreamEvent[] = []
    const usageRaw = chunk.usage as { prompt_tokens?: number; completion_tokens?: number } | null | undefined
    if (usageRaw) usage = { input: usageRaw.prompt_tokens ?? 0, output: usageRaw.completion_tokens ?? 0 }

    const choices = chunk.choices as Array<Record<string, unknown>> | undefined
    const choice = choices?.[0]
    if (!choice) return events
    const delta = choice.delta as Record<string, unknown> | undefined
    if (delta) {
      const content = delta.content
      if (typeof content === 'string' && content) events.push({ type: 'text_delta', index: textIndex, delta: content })
      const reasoning = delta.reasoning_content ?? delta.reasoning
      if (typeof reasoning === 'string' && reasoning) events.push({ type: 'thinking_delta', delta: reasoning })
      const calls = delta.tool_calls as Array<Record<string, unknown>> | undefined
      if (calls) events.push(...toolCallEvents(calls))
    }
    const finish = choice.finish_reason
    if (typeof finish === 'string') {
      const mapped = stopReasonMap(finish)
      if (mapped) stopReason = mapped
    }
    return events
  }

  function toolCallEvents(calls: Array<Record<string, unknown>>): StreamEvent[] {
    const events: StreamEvent[] = []
    for (const tc of calls) {
      const idx = typeof tc.index === 'number' ? tc.index : 0
      const fn = tc.function as { name?: string; arguments?: string } | undefined
      if (typeof tc.id === 'string' && tc.id) {
        toolAcc.set(idx, { id: tc.id, name: fn?.name ?? '', args: '', index: idx })
        events.push({ type: 'toolcall_start', index: idx, id: tc.id, name: fn?.name ?? '' })
      }
      const args = fn?.arguments
      if (typeof args === 'string' && args) {
        const acc = toolAcc.get(idx)
        if (acc) acc.args += args
        events.push({ type: 'toolcall_delta', index: idx, delta: args })
      }
    }
    return events
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep = buffer.indexOf('\n')
      while (sep >= 0) {
        const line = buffer.slice(0, sep).trimEnd()
        buffer = buffer.slice(sep + 1)
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim()
          if (payload && payload !== '[DONE]') {
            const chunk = safeJson(payload)
            if (chunk) {
              for (const ev of handleChunk(chunk)) {
                if (!started && ev.type !== 'error') {
                  yield { type: 'start' }
                  started = true
                }
                yield ev
              }
            }
          }
        }
        sep = buffer.indexOf('\n')
      }
    }
    yield { type: 'done', usage, stopReason }
  } catch (e) {
    if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return
    const err = e instanceof Error ? e : new Error(String(e))
    yield { type: 'error', error: err }
  } finally {
    reader.releaseLock()
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}
