import type { Message, ContentBlock } from './types'

/**
 * Neutral messages -> OpenAI chat.completions wire format.
 * thinking 块回放时跳过 (跨 provider 切换由 replayFilter 降级为文本).
 */

type WireMessage = Record<string, unknown>

export function mapMessages(systemPrompt: string, messages: Message[]): WireMessage[] {
  const out: WireMessage[] = []
  if (systemPrompt) out.push({ role: 'system', content: systemPrompt })

  for (const m of messages) {
    if (m.role === 'user') {
      pushMerged(out, 'user', userContent(m.content))
    } else if (m.role === 'assistant') {
      pushMerged(out, 'assistant', assistantContent(m.content))
    } else {
      for (const b of m.content) {
        if (b.type !== 'toolResult') continue
        out.push({ role: 'tool', tool_call_id: b.id, content: b.content.map((t) => t.text).join('\n') || '(empty)' })
      }
    }
  }
  return out
}

/** merge consecutive same-role, except 'tool' role (protocol requires separate tool msgs). */
function pushMerged(out: WireMessage[], role: 'user' | 'assistant' | 'tool', msg: WireMessage | null): void {
  if (!msg) return
  const last = out[out.length - 1]
  if (last && last.role === role && role !== 'tool') {
    last.content = mergeContent(last.content, msg.content)
    last.tool_calls = [...asArray(last.tool_calls), ...asArray(msg.tool_calls)]
    return
  }
  out.push(msg)
}

function mergeContent(a: unknown, b: unknown): unknown {
  if (typeof a === 'string' && typeof b === 'string') return a + '\n' + b
  return [...asArray(a), ...asArray(b)]
}

function asArray(v: unknown): unknown[] {
  if (v == null) return []
  if (typeof v === 'string') return [{ type: 'text', text: v }]
  return Array.isArray(v) ? v : [v]
}

function joinText(blocks: ContentBlock[]): string {
  return blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n')
}

function userContent(blocks: ContentBlock[]): WireMessage | null {
  if (blocks.length === 0) return null
  const hasImage = blocks.some((b) => b.type === 'image')
  if (!hasImage) return { role: 'user', content: joinText(blocks) }
  const parts = blocks.map((b) => {
    if (b.type === 'image') return { type: 'image_url', image_url: { url: `data:${b.mimeType};base64,${b.data}` } }
    return { type: 'text', text: (b as { text: string }).text }
  })
  return { role: 'user', content: parts }
}

function assistantContent(blocks: ContentBlock[]): WireMessage | null {
  const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
  const calls = blocks.filter((b) => b.type === 'toolCall')
  if (!text && calls.length === 0) return null // thinking-only assistant: nothing to send
  const msg: WireMessage = { role: 'assistant', content: text }
  if (calls.length) {
    msg.tool_calls = calls.map((b) => ({
      id: (b as { id: string }).id,
      type: 'function',
      function: { name: (b as { name: string }).name, arguments: JSON.stringify((b as { arguments: unknown }).arguments) },
    }))
  }
  return msg
}
