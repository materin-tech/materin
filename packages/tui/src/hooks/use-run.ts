/**
 * Polling run loop: 每 300ms GET /session/:id/messages (瞬时短请求, 无在途流式
 * fetch — 规避 Bun stdin 饿死 bug). 光标走 root→leaf; 流式内容留在 live 区,
 * 块/回合完成后经 createConsumer 移入 Static.
 */

import { useEffect, useRef } from 'react'
import type { MessageRow } from '@materin/core'
import type { LiveStream, LastTool, TranscriptPart } from '../components/types'
import { createConsumer, freshCursor, type LiveEntry } from './run-consume'

const POLL_MS = 300
const TIMEOUT_MS = 120_000
const ABORT_TIMEOUT_MS = 10_000

export interface UseRunDeps {
  base: string
  sessionId: string
  running: boolean
  interrupting: boolean
  pushItem(part: TranscriptPart): void
  setLive(live: LiveStream | null): void
  setLastTool(tool: LastTool | null): void
  onDone(): void
}

export function useRun(deps: UseRunDeps): void {
  const ref = useRef(deps)
  useEffect(() => {
    ref.current = deps
  })

  const cursor = useRef(freshCursor())
  const live = useRef<LiveEntry | null>(null)
  const deadline = useRef(0)
  const abortDeadline = useRef(0)
  const inFlight = useRef(false)
  const consumer = createConsumer(
    {
      pushItem: (part) => ref.current.pushItem(part),
      setLive: (lv) => ref.current.setLive(lv),
      setLastTool: (tool) => ref.current.setLastTool(tool),
    },
    { cursor: cursor, live: live },
  )

  // 新会话 (e.g. /new): 光标回到哨兵位, 下个 tick 跳过历史
  useEffect(() => {
    cursor.current = freshCursor()
    live.current = null
  }, [deps.sessionId])

  useEffect(() => {
    if (!deps.running) return
    deadline.current = Date.now() + TIMEOUT_MS
    live.current = null
    ref.current.setLive(null)
    ref.current.setLastTool(null)
    const timer = setInterval(() => {
      void tick()
    }, POLL_MS)
    return () => {
      clearInterval(timer)
      inFlight.current = false
    }
  }, [deps.running])

  useEffect(() => {
    if (deps.interrupting) abortDeadline.current = Date.now() + ABORT_TIMEOUT_MS
  }, [deps.interrupting])

  async function tick(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res = await fetch(ref.current.base + '/session/' + ref.current.sessionId + '/messages')
      if (!res.ok) throw new Error('messages -> ' + String(res.status))
      const rows = (await res.json()) as MessageRow[]
      if (cursor.current.msgIdx === 0 && cursor.current.blockIdx === 0 && cursor.current.charIdx === 0) {
        // 首次轮询 (含恢复旧会话): 跳过完整历史; 末条未完成则从该行消费
        const lastRow = rows[rows.length - 1]
        const start = lastRow && lastRow.role === 'assistant' && lastRow.stopReason === null ? rows.length - 1 : rows.length
        cursor.current = { msgIdx: start, blockIdx: 0, charIdx: 0 }
      }
      consumer.consume(rows)
      const lastRow = rows[rows.length - 1]
      const done =
        lastRow !== undefined && lastRow.role === 'assistant' && lastRow.stopReason !== null && cursor.current.msgIdx >= rows.length
      if (done || Date.now() > deadline.current || (ref.current.interrupting && Date.now() > abortDeadline.current)) {
        consumer.flushLive()
        ref.current.onDone()
      }
    } catch {
      // 单次轮询失败: 下个周期重试
    } finally {
      inFlight.current = false
    }
  }
}
