/** Pure helpers for the polling run state machine (use-run.ts). */

export interface Cursor {
  msgIdx: number
  blockIdx: number
  charIdx: number
}

export const SENTINEL: Cursor = { msgIdx: 0, blockIdx: 0, charIdx: 0 }

export const PREVIEW_MAX = 160
export const ARGS_MAX = 80

export interface Block {
  type: string
  text?: string
  thinking?: string
  name?: string
  arguments?: unknown
  content?: Array<{ text?: string }>
  isError?: boolean
}

export function clip(s: string, max: number): string {
  const one = s.replace(/\n+/g, ' ').trim()
  return one.length > max ? one.slice(0, max) + '…' : one
}

export function blockText(block: Block): string {
  if (block.type === 'thinking') return String(block.thinking ?? '')
  return String(block.text ?? '')
}

export function toolResultText(block: Block): string {
  const content = Array.isArray(block.content) ? block.content : []
  return content.map((c) => String(c.text ?? '')).join(' ').trim() || 'done'
}

export function advanceMsg(cur: Cursor): void {
  cur.msgIdx += 1
  cur.blockIdx = 0
  cur.charIdx = 0
}

export function toolArgs(block: Block): string {
  return clip(JSON.stringify(block.arguments ?? {}), ARGS_MAX)
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
