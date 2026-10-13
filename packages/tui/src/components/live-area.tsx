/** Live area: mode indicator, @ popup, spinner / input box, status line (CC style). */

import { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { VERSION } from '@materin/core'
import type { LiveStream, LastTool } from './types'

const FRAMES = ['✻', '✶', '✳', '✢', '●']
const FRAME_MS = 120
const LIVE_TEXT_MAX = 600
const LIVE_TOOL_MAX = 70

function Spinner({ verb }: { verb: string }): JSX.Element {
  const [i, setI] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setI((v) => (v + 1) % FRAMES.length), FRAME_MS)
    return () => clearInterval(timer)
  }, [])
  return (
    <Text>
      <Text color="magenta">{FRAMES[i] ?? '✻'}</Text>
      <Text> {verb}… (esc/Ctrl+C to interrupt)</Text>
    </Text>
  )
}

function FilePopup({ candidates, selIdx }: { candidates: string[]; selIdx: number }): JSX.Element {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {candidates.map((c, i) => (
        <Text key={c + ':' + String(i)} color={i === selIdx ? 'cyan' : 'gray'}>
          {i === selIdx ? '› ' : '  '}
          {c}
        </Text>
      ))}
    </Box>
  )
}

function LiveStreamText({ live, verbose }: { live: LiveStream; verbose: boolean }): JSX.Element {
  const shown = live.text.length > LIVE_TEXT_MAX ? '…' + live.text.slice(-LIVE_TEXT_MAX) : live.text
  if (live.kind === 'thinking') {
    if (!verbose) {
      return (
        <Box paddingLeft={2}>
          <Text dimColor italic>✻ Thinking… (ctrl+o 展开)</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text dimColor italic>✻ Thinking… (ctrl+o 折叠)</Text>
        <Text dimColor italic>{shown}</Text>
      </Box>
    )
  }
  return (
    <Box paddingLeft={2}>
      <Text>{shown}</Text>
    </Box>
  )
}

function LastToolLine({ tool }: { tool: LastTool }): JSX.Element {
  return (
    <Text dimColor>
      {'  ⎿ '}{tool.name}({tool.args.length > LIVE_TOOL_MAX ? tool.args.slice(0, LIVE_TOOL_MAX) + '…' : tool.args})
    </Text>
  )
}

function InputBox({ input }: { input: string }): JSX.Element {
  // 横向滚动: 只显示放得下的尾部 (CC 同款, 不折行溢出)
  const cols = process.stdout.columns ?? 80
  const avail = Math.max(8, cols - 8)
  const chars = Array.from(input)
  const visible = chars.length > avail ? chars.slice(-avail).join('') : input
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <Text wrap="end">{'> '}{visible}{'█'}</Text>
    </Box>
  )
}

function StatusLine({ model, mode }: { model: string; mode: string }): JSX.Element {
  return (
    <Text dimColor>
      materin v{VERSION} · {model} · {mode} mode · Shift+Tab 模式 · /help 命令
    </Text>
  )
}

export interface LiveAreaProps {
  mode: string
  model: string
  running: boolean
  interrupting: boolean
  input: string
  live: LiveStream | null
  lastTool: LastTool | null
  candidates: string[]
  selIdx: number
  verbose: boolean
}

export function LiveArea(props: LiveAreaProps): JSX.Element {
  const verb = props.interrupting
    ? 'Interrupting'
    : props.live !== null && props.live.kind === 'text'
      ? 'Answering'
      : props.lastTool !== null
        ? 'Working'
        : 'Thinking'
  return (
    <Box flexDirection="column">
      {props.mode !== 'manual' && <Text dimColor>⏵⏵ {props.mode} mode</Text>}
      {props.candidates.length > 0 && <FilePopup candidates={props.candidates} selIdx={props.selIdx} />}
      {props.running && (
        <Box flexDirection="column">
          <Spinner verb={verb} />
          {props.lastTool !== null && <LastToolLine tool={props.lastTool} />}
          {props.live !== null && <LiveStreamText live={props.live} verbose={props.verbose} />}
        </Box>
      )}
      <InputBox input={props.input} />
      <StatusLine model={props.model} mode={props.mode} />
    </Box>
  )
}
