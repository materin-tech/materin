import type { Message, StreamContext, StreamEvent, Provider, ContentBlock } from './types'
import { anthropicThinking, normalizeThinking } from './thinking'

const ANTHROPIC_VERSION = '2023-06-01'

interface ProviderOptions {
  apiKey?: string
  baseUrl?: string
}

/**
 * Anthropic Messages wire-API provider (one of the 6 planned wire APIs).
 * Maps our neutral message format to /v1/messages and parses the SSE stream
 * into neutral StreamEvents.
 */
export function createAnthropicProvider(opts: ProviderOptions = {}): Provider {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
  const baseUrl = (opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '')

  async function* stream(ctx: StreamContext): AsyncIterable<StreamEvent> {
    if (!apiKey) {
      yield { type: 'error', error: new Error('ANTHROPIC_API_KEY is not set') }
      return
    }

    const body: Record<string, unknown> = {
      model: ctx.model,
      max_tokens: ctx.maxTokens ?? 16384,
      stream: true,
      system: ctx.systemPrompt || undefined,
      messages: mapMessages(ctx.messages),
      tools: ctx.tools.length > 0
        ? ctx.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
        : undefined,
    }
    const thinkingLevel = normalizeThinking(ctx.thinkingLevel)
    if (thinkingLevel !== 'off') {
      const adjusted = anthropicThinking(thinkingLevel, ctx.maxTokens ?? 16384)
      body.thinking = adjusted.thinking
      body.max_tokens = adjusted.max_tokens
    }

    let res: Response
    try {
      res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ctx.signal,
      })
    } catch (e) {
      if (isAbort(e)) return
      yield { type: 'error', error: e instanceof Error ? e : new Error(String(e)) }
      return
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      yield { type: 'error', error: new Error(`anthropic API ${res.status}: ${text.slice(0, 2000)}`) }
      return
    }

    yield* parseSseStream(res.body, ctx.signal)
  }

  return { stream }
}

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

async function* parseSseStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<StreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // accumulated tool-call raw JSON per content index
  const toolRaw = new Map<number, string>()
  let usage: { input: number; output: number } = { input: 0, output: 0 }
  let stopReason: string | undefined

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sep: number
      while ((sep = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, sep).trimEnd()
        buffer = buffer.slice(sep + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue

        let evt: Record<string, unknown>
        try {
          evt = JSON.parse(payload) as Record<string, unknown>
        } catch {
          continue
        }

        const events = handleAnthropicEvent(evt, toolRaw)
        for (const ev of events) {
          if (ev.type === 'done') {
            usage = ev.usage ?? usage
            stopReason = ev.stopReason ?? stopReason
            // done is emitted at the very end below
            continue
          }
          yield ev
        }
        if (evt.type === 'message_stop') {
          yield { type: 'done', usage, stopReason }
          return
        }
        if (evt.type === 'error') {
          yield { type: 'error', error: new Error(String(evt.error ?? 'stream error')) }
          return
        }
      }
    }
    yield { type: 'done', usage, stopReason }
  } catch (e) {
    if (isAbort(e)) return
    yield { type: 'error', error: e instanceof Error ? e : new Error(String(e)) }
  } finally {
    reader.releaseLock()
    void signal
  }
}

function handleAnthropicEvent(
  evt: Record<string, unknown>,
  toolRaw: Map<number, string>,
): StreamEvent[] {
  const type = evt.type as string
  const index = typeof evt.index === 'number' ? evt.index : 0

  switch (type) {
    case 'message_start': {
      const msg = evt.message as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined
      const start: StreamEvent = { type: 'start' }
      if (!msg?.usage) return [start]
      const done: StreamEvent = { type: 'done', usage: { input: msg.usage.input_tokens ?? 0, output: 0 } }
      return [start, done]
    }
    case 'content_block_start': {
      const block = evt.content_block as { type: string; id?: string; name?: string } | undefined
      if (!block) return []
      if (block.type === 'tool_use') {
        return [{ type: 'toolcall_start', index, id: block.id ?? '', name: block.name ?? '' }]
      }
      if (block.type === 'text') return [{ type: 'text_start', index }]
      return []
    }
    case 'content_block_delta': {
      const delta = evt.delta as { type: string; text?: string; thinking?: string; partial_json?: string } | undefined
      if (!delta) return []
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        return [{ type: 'text_delta', index, delta: delta.text }]
      }
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        return [{ type: 'thinking_delta', delta: delta.thinking }]
      }
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        toolRaw.set(index, (toolRaw.get(index) ?? '') + delta.partial_json)
        return [{ type: 'toolcall_delta', index, delta: delta.partial_json }]
      }
      return []
    }
    case 'content_block_stop': {
      // tool JSON may still be incomplete until message_delta; parse lazily in the loop.
      void toolRaw
      return []
    }
    case 'message_delta': {
      const delta = evt.delta as { stop_reason?: string } | undefined
      const usage = evt.usage as { output_tokens?: number } | undefined
      return [{
        type: 'done',
        usage: { input: 0, output: usage?.output_tokens ?? 0 },
        stopReason: delta?.stop_reason,
      }]
    }
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// Neutral -> Anthropic mapping
// ---------------------------------------------------------------------------

function mapMessages(messages: Message[]): Array<{ role: 'user' | 'assistant'; content: unknown[] }> {
  const out: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = []
  const push = (role: 'user' | 'assistant', blocks: unknown[]) => {
    const last = out[out.length - 1]
    if (last && last.role === role) {
      // anthropic requires strict alternation: merge consecutive same-role turns
      last.content.push(...blocks)
    } else {
      out.push({ role, content: blocks })
    }
  }

  for (const m of messages) {
    if (m.role === 'user') {
      push('user', m.content.map(blockToAnthropic))
    } else if (m.role === 'assistant') {
      // thinking blocks are not replayed (M1: extended thinking off, replay unsupported)
      push('assistant', m.content.filter((b) => b.type !== 'thinking').map(blockToAnthropic))
    } else {
      push('user', m.content.map(toolResultToAnthropic))
    }
  }

  if (out.length > 0 && out[0]!.role !== 'user') {
    out.unshift({ role: 'user', content: [{ type: 'text', text: '(conversation start)' }] })
  }
  return out
}

function blockToAnthropic(b: ContentBlock): unknown {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text }
    case 'image':
      return { type: 'image', source: { type: 'base64', media_type: b.mimeType, data: b.data } }
    case 'toolCall':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.arguments }
    default:
      return { type: 'text', text: '' }
  }
}

function toolResultToAnthropic(b: ContentBlock): unknown {
  if (b.type !== 'toolResult') return { type: 'text', text: '' }
  return {
    type: 'tool_result',
    tool_use_id: b.id,
    content: b.content.map((c) => ({ type: 'text', text: c.text })).join('\n') || '(empty)',
    is_error: b.isError || undefined,
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
}
