/**
 * 提交/命令/动作 hook: runPrompt/runCommand/cycleMode/abort — 全部经 WorkerHttp
 * (主线程零 fetch — Bun runtime bug: raw stdin 开始后主线程 fetch 使 useInput 失效).
 */

import { nextMode } from '@materin/core'
import { commandOutput, type CommandBody } from '../components/command-output'
import { errMsg } from './run-helpers'
import type { WorkerHttp } from '../http'
import type { TranscriptPart } from '../components/types'

export interface Actions {
  runPrompt(text: string): Promise<void>
  runCommand(text: string): Promise<void>
  cycleMode(): Promise<void>
  abort(): void
}

export interface ActionsDeps {
  http: WorkerHttp
  /** 服务器返回 409 (仍在运行) 时转排队 — App 注入. */
  onQueue?(text: string): void
  sessionId: string
  mode: string
  runningRef: { current: boolean }
  pushItem(part: TranscriptPart): void
  setRunning(v: boolean): void
  setInterrupting(v: boolean): void
  setMode(next: string): void
  setSessionId(next: string): void
}

export function useActions(deps: ActionsDeps): Actions {
  async function runPrompt(text: string): Promise<void> {
    deps.setRunning(true)
    try {
      await deps.http.request('POST', '/session/' + deps.sessionId + '/prompt', { text: text })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('409') && deps.onQueue) {
        deps.onQueue(text)
        return
      }
      deps.pushItem({ kind: 'system', text: 'error: ' + msg })
      deps.setRunning(false)
    }
  }

  async function runCommand(text: string): Promise<void> {
    deps.setRunning(true)
    try {
      const body = await deps.http.request<CommandBody>('POST', '/session/' + deps.sessionId + '/prompt', { text: text })
      const out = commandOutput(body)
      if (out) deps.pushItem({ kind: 'system', text: out })
      if (body.sessionId) deps.setSessionId(body.sessionId)
    } catch (e) {
      deps.pushItem({ kind: 'system', text: 'error: ' + errMsg(e) })
    } finally {
      deps.setRunning(false)
    }
  }
  async function cycleMode(): Promise<void> {
    try {
      const updated = await deps.http.request<{ permissionMode?: string }>(
        'POST',
        '/session/' + deps.sessionId + '/mode',
        { mode: nextMode(deps.mode) },
      )
      const next = updated.permissionMode ?? deps.mode
      deps.setMode(next)
      deps.pushItem({ kind: 'mode', text: next })
    } catch (e) {
      deps.pushItem({ kind: 'system', text: 'mode switch failed: ' + errMsg(e) })
    }
  }

  function abort(): void {
    if (!deps.runningRef.current) return
    deps.setInterrupting(true)
    void deps.http.request('POST', '/session/' + deps.sessionId + '/abort').catch(() => {})
  }

  return { runPrompt: runPrompt, runCommand: runCommand, cycleMode: cycleMode, abort: abort }
}
