/**
 * Vanilla-TS DOM rendering helpers for the Materin web UI (no framework).
 * Pure render functions only — main.ts owns state, fetching and SSE.
 */

export interface UiBlock {
  type: string
  text?: string
  id?: string
  name?: string
  arguments?: unknown
  mimeType?: string
  data?: string
  content?: UiBlock[]
  isError?: boolean
}

export interface UiMessage {
  id: string
  role: 'user' | 'assistant' | 'toolResult'
  content: UiBlock[]
}

const TOOL_PREVIEW_CHARS = 80
const RESULT_PREVIEW_CHARS = 200

export function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function p(text: string): HTMLElement {
  return el('div', 'para', text)
}

export function renderRichText(text: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  const fence = /```[^\n]*\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) frag.append(p(text.slice(last, m.index)))
    frag.append(codeBlock(m[1] ?? ''))
    last = fence.lastIndex
  }
  if (last < text.length) frag.append(p(text.slice(last)))
  return frag
}

function codeBlock(code: string): HTMLElement {
  const pre = el('pre')
  const codeEl = el('code')
  codeEl.textContent = code
  pre.append(codeEl)
  return pre
}

export function renderMessages(container: HTMLElement, messages: UiMessage[]): void {
  container.replaceChildren()
  for (const msg of messages) container.append(renderMessage(msg))
  container.scrollTop = container.scrollHeight
}

export function renderMessage(msg: UiMessage): HTMLElement {
  const wrap = el('div', 'msg ' + msg.role)
  const bubble = el('div', 'bubble')
  if (msg.role === 'toolResult') {
    for (const block of msg.content) {
      const tr = block as { type?: string; name?: unknown; content?: { type?: string; text?: unknown }[] }
      if (tr.type !== 'toolResult') continue
      const text = tr.content?.map((tb) => (typeof tb.text === 'string' ? tb.text : '')).join('\n') ?? ''
      wrap.append(el('div', 'tool-result', text.slice(0, RESULT_PREVIEW_CHARS)))
    }
    return wrap
  }
  for (const block of msg.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      bubble.append(renderRichText(block.text))
    } else if (block.type === 'image' && typeof block.data === 'string') {
      bubble.append(imageEl(block.mimeType ?? 'image/png', block.data))
    } else if (block.type === 'toolCall') {
      bubble.append(toolCallEl(block))
    }
  }
  if (bubble.childElementCount > 0) wrap.append(bubble)
  return wrap
}

function imageEl(mime: string, data: string): HTMLElement {
  const img = document.createElement('img')
  img.src = 'data:' + mime + ';base64,' + data
  img.alt = 'attached image'
  return img
}

function toolCallEl(block: UiBlock): HTMLElement {
  const args = (block.arguments ?? {}) as Record<string, unknown>
  const preview = JSON.stringify(args).slice(0, TOOL_PREVIEW_CHARS)
  const details = el('details', 'tool')
  details.append(el('summary', undefined, '⏺ ' + (block.name ?? '?') + '(' + preview + ')'))
  if (block.name === 'edit') details.append(editDiff(args))
  return details
}

/** Line-based diff view for edit tool calls: old lines red, new lines green (no LCS). */
function editDiff(args: Record<string, unknown>): HTMLElement {
  const box = el('div', 'diff')
  const oldS = typeof args['old_string'] === 'string' ? args['old_string'] : ''
  const newS = typeof args['new_string'] === 'string' ? args['new_string'] : ''
  for (const line of oldS.split('\n')) box.append(el('div', 'diff-del', '− ' + line))
  for (const line of newS.split('\n')) box.append(el('div', 'diff-add', '+ ' + line))
  return box
}
