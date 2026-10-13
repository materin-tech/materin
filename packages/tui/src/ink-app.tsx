/** Ink root: Static transcript + live area; useInput + useRun + @ completion. */

import { useRef, useState } from 'react'
import { Box } from 'ink'
import { nextMode } from '@materin/core'
import { Transcript } from './components/transcript'
import { LiveArea } from './components/live-area'
import { useRun } from './hooks/use-run'
import { useFileComplete } from './hooks/use-file-complete'
import { useInputHandlers } from './hooks/use-input-handlers'
import { commandOutput, type CommandBody } from './components/command-output'
import { errMsg } from './hooks/run-helpers'
import type { AppProps, TranscriptItem, TranscriptPart, LiveStream, LastTool } from './components/types'

export function App(props: AppProps): JSX.Element {
  const [items, setItems] = useState<TranscriptItem[]>(() => [
  { id: 0, kind: 'logo', version: props.version ?? 'dev' },
  { id: 1, kind: 'system', text: props.banner },
])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState(props.initialMode)
  const [sessionId, setSessionId] = useState(props.sessionId)
  const [running, setRunning] = useState(false)
  const [interrupting, setInterrupting] = useState(false)
  const [live, setLive] = useState<LiveStream | null>(null)

  const [lastTool, setLastTool] = useState<LastTool | null>(null)
  const idRef = useRef(2)
  const runningRef = useRef(false)
  runningRef.current = running

  function pushItem(part: TranscriptPart): void {
    const item = { ...part, id: idRef.current++ } as TranscriptItem
    setItems((prev) => [...prev, item])
  }

  useRun({
    base: props.base,
    sessionId: sessionId,
    running: running,
    interrupting: interrupting,
    pushItem: pushItem,
    setLive: setLive,
    setLastTool: setLastTool,
    onDone: () => {
      setRunning(false)
      setInterrupting(false)
    },
  })

  const at = useFileComplete({ base: props.base, sessionId: sessionId, input: input, enabled: !running })

  async function apiPost(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(props.base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('API ' + path + ' -> ' + String(res.status))
    return res.json()
  }

  async function runPrompt(text: string): Promise<void> {
    setRunning(true)
    try {
      await apiPost('/session/' + sessionId + '/prompt', { text: text })
    } catch (e) {
      pushItem({ kind: 'system', text: 'error: ' + errMsg(e) })
      setRunning(false)
    }
  }

  /** Slash command: await JSON response, render output/models/error locally. */
  async function runCommand(text: string): Promise<void> {
    setRunning(true)
    try {
      const body = (await apiPost('/session/' + sessionId + '/prompt', { text: text })) as CommandBody
      const out = commandOutput(body)
      if (out) pushItem({ kind: 'system', text: out })
      if (body.sessionId) setSessionId(body.sessionId)
    } catch (e) {
      pushItem({ kind: 'system', text: 'error: ' + errMsg(e) })
    } finally {
      setRunning(false)
    }
  }

  async function cycleMode(): Promise<void> {
    try {
      const updated = (await apiPost('/session/' + sessionId + '/mode', { mode: nextMode(mode) })) as {
        permissionMode?: string
      }
      const next = updated.permissionMode ?? mode
      setMode(next)
      pushItem({ kind: 'mode', text: next })
    } catch (e) {
      pushItem({ kind: 'system', text: 'mode switch failed: ' + errMsg(e) })
    }
  }

  function abort(): void {
    if (!runningRef.current) return
    setInterrupting(true)
    void fetch(props.base + '/session/' + sessionId + '/abort', { method: 'POST' }).catch(() => {})
  }

  function submit(): void {
    if (input.trim().length === 0) return
    submitPaste('')
  }

  /** 提交当前输入 + 粘贴文本 (合并块内含回车时用); 单行语义, \r\n 已剥离. */
  function submitPaste(extra: string): void {
    const text = (input + extra).trim()
    if (text.length === 0) return
    setInput('')
    if (text === '/exit') {
      props.onExit()
      return
    }
    pushItem({ kind: 'user', text: text })
    if (text.startsWith('/')) {
      void runCommand(text)
      return
    }
    void runPrompt(text)
  }

  useInputHandlers({
    runningRef: runningRef,
    at: at,
    setInput: setInput,
    submit: submit,
    submitPaste: submitPaste,
    cycleMode: () => {
      void cycleMode()
    },
    abort: abort,
    onExit: props.onExit,
  })

  return (
    <Box flexDirection="column">
      <Transcript items={items} />
      <LiveArea
        mode={mode}
        model={props.model}
        running={running}
        interrupting={interrupting}
        input={input}
        live={live}
        lastTool={lastTool}
        candidates={at.candidates}
        selIdx={at.selIdx}
      />
    </Box>
  )
}
