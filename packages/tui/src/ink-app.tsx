/** Ink root: Static transcript + live area; useInput + useRun + @ completion. */

import { useEffect, useRef, useState } from 'react'
import { Box } from 'ink'
import { Transcript } from './components/transcript'
import { LiveArea } from './components/live-area'
import { useRun } from './hooks/use-run'
import { useFileComplete } from './hooks/use-file-complete'
import { useCommandComplete } from './hooks/use-command-complete'
import { useInputHandlers } from './hooks/use-input-handlers'
import { useActions } from './hooks/use-actions'
import { createWorkerHttp } from './http'
import type { AppProps, TranscriptItem, TranscriptPart, LiveStream, LastTool } from './components/types'

export function App(props: AppProps): JSX.Element {
  const [items, setItems] = useState<TranscriptItem[]>(() => [
    { id: 0, kind: 'logo', version: props.version ?? 'dev' },
    { id: 1, kind: 'system', text: props.banner },
  ])
  const [input, setInput] = useState('')
  const inputRef = useRef('')
  // 同步 ref: 组合按键块内多次 setInput + submit 必须读到即时值 (渲染批处理会延迟)
  const updateInput = (updater: (prev: string) => string): void => {
    const next = updater(inputRef.current)
    inputRef.current = next
    setInput(next)
  }
  const [mode, setMode] = useState(props.initialMode)
  const [sessionId, setSessionId] = useState(props.sessionId)
  const [running, setRunning] = useState(false)
  const [interrupting, setInterrupting] = useState(false)
  const [live, setLive] = useState<LiveStream | null>(null)
  const [lastTool, setLastTool] = useState<LastTool | null>(null)
  const [queue, setQueue] = useState<string[]>([])
  const [verbose, setVerbose] = useState(false)
  const idRef = useRef(2)
  const historyRef = useRef<string[]>([])
  const historyIdxRef = useRef(-1)
  const draftRef = useRef('')
  const runningRef = useRef(false)
  runningRef.current = running

  function pushItem(part: TranscriptPart): void {
    const item = { ...part, id: idRef.current++ } as TranscriptItem
    setItems((prev) => [...prev, item])
  }

  const [http] = useState(() => createWorkerHttp(props.base))
  useEffect(() => {
    return () => http.close()
  }, [http])

  const actions = useActions({
    http: http,
    sessionId: sessionId,
    mode: mode,
    runningRef: runningRef,
    pushItem: pushItem,
    setRunning: setRunning,
    onQueue: (t: string) => {
      setQueue((q) => [...q, t])
      pushItem({ kind: 'system', text: '⏳ [queued] ' + t })
    },
    setInterrupting: setInterrupting,
    setMode: setMode,
    setSessionId: setSessionId,
  })

  useRun({
    http: http,
    sessionId: sessionId,
    running: running,
    interrupting: interrupting,
    pushItem: pushItem,
    setLive: setLive,
    setLastTool: setLastTool,
    onDone: () => {
      setRunning(false)
      setInterrupting(false)
      setQueue((q) => {
        if (q.length === 0) return q
        const next = q[0]
        if (next === undefined) return q
        setTimeout(() => submitText(next), 60)
        return q.slice(1)
      })
    },
  })

  const at = useFileComplete({ http: http, sessionId: sessionId, input: input, enabled: true })
  const cmd = useCommandComplete({ http: http, input: input, enabled: true })

  /** 排队策略: 运行中提交 → 入队, run 结束自动依次提交 (CC 同款). */
  function submitText(text: string): void {
    const t = text.trim()
    if (t.length === 0) return
    if (t.startsWith('/')) {
      pushItem({ kind: 'user', text: t })
      void actions.runCommand(t)
      return
    }
    // 提交瞬间同步置位: POST 往返期间新输入必须走队列 (服务器 409 兜底)
    setRunning(true)
    runningRef.current = true
    pushItem({ kind: 'user', text: t })
    void actions.runPrompt(t)
  }

  function submit(): void {
    // \ + Enter: 续行 (CC 同款, 任何终端可用)
    if (inputRef.current.endsWith('\\')) {
      updateInput((prev) => prev.replace(/\\$/, '\n'))
      return
    }
    if (inputRef.current.trim().length === 0) return
    submitPaste('')
  }

  /** 提交当前输入 + 粘贴文本 (合并块含回车时用). */
  function submitPaste(extra: string): void {
    const text = (inputRef.current + extra).trim()
    if (text.length === 0) return
    // 同步清空 (setInput 是异步的, 段循环内第二次提交会读到未清空的 ref)
    inputRef.current = ''
    setInput('')
    if (text === '/exit') {
      props.onExit()
      return
    }
    if (runningRef.current) {
      setQueue((q) => [...q, text])
      pushItem({ kind: 'system', text: '⏳ [queued] ' + text })
      return
    }
    submitText(text)
  }

  useInputHandlers({
    runningRef: runningRef,
    at: at,
    cmd: cmd,
    setInput: updateInput,
    submit: submit,
    submitPaste: submitPaste,
    cycleMode: () => void actions.cycleMode(),
    abort: actions.abort,
    toggleVerbose: () => setVerbose((v) => !v),
    inputText: () => inputRef.current,
    onNewline: () => updateInput((prev) => prev + '\n'),
    onHistoryUp: () => {
      const h = historyRef.current
      if (h.length === 0) return
      if (historyIdxRef.current === -1) {
        draftRef.current = inputRef.current
        historyIdxRef.current = h.length - 1
      } else if (historyIdxRef.current > 0) {
        historyIdxRef.current -= 1
      }
      setInput(h[historyIdxRef.current] ?? '')
    },
    onHistoryDown: () => {
      const h = historyRef.current
      if (historyIdxRef.current === -1) return
      historyIdxRef.current += 1
      if (historyIdxRef.current >= h.length) {
        historyIdxRef.current = -1
        setInput(draftRef.current)
      } else {
        setInput(h[historyIdxRef.current] ?? '')
      }
    },
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
        cmdCandidates={cmd.candidates}
        cmdSelIdx={cmd.selIdx}
        verbose={verbose}
      />
    </Box>
  )
}
