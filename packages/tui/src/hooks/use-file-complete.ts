/**
 * @ 文件补全 hook: 输入末尾 @token → 防抖 GET /session/:id/files?q=
 * → CC 式候选弹层 (最多 6 项, ↑/↓ 选择, Tab/Enter 补全, Esc 关闭).
 */

import { useEffect, useRef, useState } from 'react'
import type { WorkerHttp } from '../http'

export const AT_RE = /(?:^|\s)@(\S*)$/

const FETCH_DEBOUNCE_MS = 120
const MAX_CANDIDATES = 200  // 全量保留, 弹层窗口滚动展示

export interface AtComplete {
  candidates: string[]
  selIdx: number
  /** 当前输入是否命中 @token (弹层开启条件). */
  readonly isOpen: boolean
  move(delta: number): void
  dismiss(): void
  /** 用当前选中项替换输入末尾的 @token, 返回新输入. */
  apply(): string
}

export function useFileComplete(opts: {
  http: WorkerHttp
  sessionId: string
  input: string
  enabled: boolean
}): AtComplete {
  const [candidates, setCandidates] = useState<string[]>([])
  const [selIdx, setSelIdx] = useState(0)
  const dismissed = useRef(false)
  const match = AT_RE.exec(opts.input)
  const isOpen = opts.enabled && match !== null && candidates.length > 0 && !dismissed.current

  // @token 消失即复位 dismiss 标记
  useEffect(() => {
    if (match === null) dismissed.current = false
  }, [match !== null])

  useEffect(() => {
    if (!opts.enabled || match === null || dismissed.current) {
      setCandidates([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void opts.http
        .request<{ files?: string[] }>(
          'GET',
          '/session/' + opts.sessionId + '/files?q=' + encodeURIComponent(match[1]!),
        )
        .then((body) => {
          if (cancelled) return
          setCandidates((body.files ?? []).slice(0, MAX_CANDIDATES))
          setSelIdx(0)
        })
        .catch(() => {
          if (!cancelled) setCandidates([])
        })
    }, FETCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [opts.input, opts.enabled])

  function move(delta: number): void {
    // CC 对齐: 到边缘即停, 不环绕
    setSelIdx((i) => {
      if (candidates.length === 0) return 0
      return Math.min(Math.max(i + delta, 0), candidates.length - 1)
    })
  }

  function apply(): string {
    if (!match || candidates.length === 0) return opts.input
    const next = opts.input.slice(0, opts.input.length - match[1]!.length) + (candidates[selIdx] ?? '')
    return next
  }

  function dismiss(): void {
    dismissed.current = true
    setCandidates([])
  }

  return { candidates: candidates, selIdx: selIdx, isOpen: isOpen, move: move, dismiss: dismiss, apply: apply }
}