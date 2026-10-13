/**
 * / 命令补全 hook: 输入形如 '/token' (以 / 开头且无空白) → GET /commands
 * → CC 式候选弹层 (最多 8 项, ↑/↓ 选择, Tab/Enter 补全, Esc 关闭).
 * GET /commands 首次激活时拉取一次并缓存 (ref 标记).
 */

import { useEffect, useRef, useState } from 'react'
import type { WorkerHttp } from '../http'
import type { CmdCandidate } from '../components/types'

const MAX_CANDIDATES = 8

export interface CmdComplete {
  candidates: CmdCandidate[]
  selIdx: number
  /** 当前命令名 token (小写, 无 '/'). */
  readonly token: string
  /** 当前输入仍在敲命令名 (弹层开启条件). */
  readonly isOpen: boolean
  move(delta: number): void
  dismiss(): void
  /** 用当前选中项补全: 返回 '/name ' (带尾随空格). */
  apply(): string
}

export function useCommandComplete(opts: { http: WorkerHttp; input: string; enabled: boolean }): CmdComplete {
  const [all, setAll] = useState<CmdCandidate[]>([])
  const [candidates, setCandidates] = useState<CmdCandidate[]>([])
  const [selIdx, setSelIdx] = useState(0)
  const fetchedRef = useRef(false)
  const dismissed = useRef(false)
  const active = opts.enabled && opts.input.startsWith('/') && !/\s/.test(opts.input)
  const isOpen = active && !dismissed.current && candidates.length > 0

  // 命令名输入结束 (出现空白/清空) 即复位 dismiss 标记
  useEffect(() => {
    if (!active) dismissed.current = false
  }, [active])

  // 首次激活时拉取命令表 (一次, 失败可重试)
  useEffect(() => {
    if (!active || fetchedRef.current) return
    fetchedRef.current = true
    void opts.http
      .request<{ commands?: CmdCandidate[] }>('GET', '/commands')
      .then((body) => setAll(body.commands ?? []))
      .catch(() => {
        fetchedRef.current = false
        setAll([])
      })
  }, [active])

  // 输入变化 → 重新过滤候选 (token 空则全量, cap 8)
  useEffect(() => {
    if (!active || dismissed.current) {
      setCandidates([])
      return
    }
    const token = opts.input.slice(1).toLowerCase()
    setCandidates(
      all
        .filter((c) => c.name.slice(1).toLowerCase().startsWith(token))
        .slice(0, MAX_CANDIDATES),
    )
    setSelIdx(0)
  }, [opts.input, opts.enabled, all, active, dismissed.current])

  function move(delta: number): void {
    setSelIdx((i) => (candidates.length === 0 ? 0 : (i + delta + candidates.length) % candidates.length))
  }

  function apply(): string {
    if (candidates.length === 0) return opts.input
    const name = candidates[selIdx]?.name ?? ''
    return (name.startsWith('/') ? name : '/' + name) + ' '
  }

  function dismiss(): void {
    dismissed.current = true
    setCandidates([])
  }

  const token = opts.input.startsWith('/') ? opts.input.slice(1).toLowerCase() : ''
  return { candidates: candidates, selIdx: selIdx, isOpen: isOpen, move: move, dismiss: dismiss, apply: apply, token: token }
}
