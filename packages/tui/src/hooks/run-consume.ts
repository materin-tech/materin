/** Cursor-walk consumer: maps new MessageRow content to transcript items + live stream. */

import type { MessageRow } from '@materin/core'
import type { LiveStream, LastTool, TranscriptPart } from '../components/types'
import { SENTINEL, PREVIEW_MAX, blockText, toolResultText, toolArgs, clip, advanceMsg, type Block, type Cursor } from './run-helpers'

export interface ConsumeDeps {
  pushItem(part: TranscriptPart): void
  setLive(live: LiveStream | null): void
  setLastTool(tool: LastTool | null | ((prev: LastTool | null) => LastTool | null)): void
}

export interface LiveEntry extends LiveStream {
  rowIdx: number
  blockIdx: number
}

export interface ConsumeState {
  cursor: { current: Cursor }
  live: { current: LiveEntry | null }
}

export function createConsumer(deps: ConsumeDeps, state: ConsumeState): { consume(rows: MessageRow[]): void; flushLive(): void } {
  function flushLive(): void {
    const cur = state.live.current
    if (!cur) return
    state.live.current = null
    deps.setLive(null)
    if (cur.text.trim().length === 0) return
    deps.pushItem(cur.kind === 'thinking' ? { kind: 'thinking', text: cur.text } : { kind: 'assistant-text', text: cur.text })
  }

  function consume(rows: MessageRow[]): void {
    const cur = state.cursor.current
    for (;;) {
      if (cur.msgIdx >= rows.length) break
      const row = rows[cur.msgIdx]!
      if (row.role === 'user') {
        advanceMsg(cur)
        continue
      }
      const blocks = (row.content as unknown as Block[]) ?? []
      if (cur.blockIdx >= blocks.length) {
        advanceMsg(cur)
        continue
      }
      const block = blocks[cur.blockIdx]!
      const rowComplete = row.role === 'toolResult' || row.stopReason !== null
      const blockComplete = rowComplete || cur.blockIdx < blocks.length - 1
      if (block.type === 'toolCall') {
        if (!blockComplete) break // args 仍在流式, 等下个 tick
        const item = { kind: 'tool' as const, name: String(block.name ?? ''), args: toolArgs(block) }
        deps.pushItem(item)
        deps.setLastTool({ name: item.name, args: item.args })
        cur.blockIdx += 1
        cur.charIdx = 0
        continue
      }
      if (row.role === 'toolResult') {
        const preview = clip(toolResultText(block), PREVIEW_MAX)
        deps.pushItem({
          kind: 'tool-result',
          text: preview,
          isError: block.isError === true,
        })
        // 工具结果实时进 live 区 (CC 式过程可见性)
        deps.setLastTool((prev) => (prev ? { ...prev, result: preview } : prev))
        cur.blockIdx += 1
        cur.charIdx = 0
        continue
      }
      const kind = block.type === 'thinking' ? 'thinking' : 'text'
      const entry = state.live.current
      if (entry !== null && (entry.rowIdx !== cur.msgIdx || entry.blockIdx !== cur.blockIdx)) flushLive()
      const text = blockText(block)
      if (text.length > cur.charIdx) {
        const suffix = text.slice(cur.charIdx)
        cur.charIdx = text.length
        if (state.live.current === null) {
          state.live.current = { rowIdx: cur.msgIdx, blockIdx: cur.blockIdx, kind: kind, text: '' }
        }
        const prev = state.live.current!
        state.live.current = { ...prev, kind: kind, text: prev.text + suffix }
        deps.setLive({ kind: kind, text: state.live.current.text })
      }
      if (blockComplete) {
        flushLive()
        cur.blockIdx += 1
        cur.charIdx = 0
        continue
      }
      break // 末块仍在流式
    }
  }

  return { consume: consume, flushLive: flushLive }
}

export function freshCursor(): Cursor {
  return { ...SENTINEL }
}
