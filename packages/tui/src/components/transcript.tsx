/** Static transcript renderers — each item renders once into scrollback (CC style). */

import { Box, Static, Text } from 'ink'
import type { TranscriptItem } from './types'

const THINKING_MAX = 400

function clip(s: string, max: number): string {
  const one = s.replace(/\n+/g, ' ').trim()
  return one.length > max ? one.slice(0, max) + '…' : one
}

function UserLine({ text }: { text: string }): JSX.Element {
  return <Text bold>{'> ' + text}</Text>
}

function ThinkingItem({ text }: { text: string }): JSX.Element {
  return (
    <Box flexDirection="column">
      <Text dimColor italic>
        ✻ Thinking…
      </Text>
      <Text dimColor italic>
        {clip(text, THINKING_MAX)}
      </Text>
    </Box>
  )
}

function ToolLine({ item }: { item: Extract<TranscriptItem, { kind: 'tool' }> }): JSX.Element {
  return (
    <Text>
      <Text color="cyan">⏺ {item.name}</Text>
      <Text dimColor>({item.args})</Text>
    </Text>
  )
}

function ToolResultLine({ item }: { item: Extract<TranscriptItem, { kind: 'tool-result' }> }): JSX.Element {
  return <Text dimColor={!item.isError} color={item.isError ? 'red' : undefined}>  ⎿ {item.text}</Text>
}

function Item({ item }: { item: TranscriptItem }): JSX.Element {
  switch (item.kind) {
    case 'user':
      return <UserLine text={item.text} />
    case 'assistant-text':
      return <Text>{item.text.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}
      </Text>
    case 'thinking':
      return <ThinkingItem text={item.text} />
    case 'tool':
      return <ToolLine item={item} />
    case 'tool-result':
      return <ToolResultLine item={item} />
    case 'mode':
      return <Text dimColor>⏵⏵ {item.text} mode</Text>
    case 'logo': {
      const L = ['  ▄▄▄▄▄▄▄▄', '  █ ◉ ▀ ◉ █', '  ▀▀▀▀▀▀▀▀']
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="cyan">{L[0]}   materin v{item.version}</Text>
          <Text color="cyan">{L[1]}</Text>
          <Text color="cyan">{L[2]}   shift+tab 模式 · /help 命令 · @ 文件 · ! bash</Text>
          <Text dimColor>  ctrl+c 中止/退出 · 当前目录即工作空间</Text>
        </Box>
      )
    }
    case 'system':
      return <Text dimColor>{item.text}</Text>
    default:
      return <Text dimColor>·</Text>
  }
}

export function Transcript({ items }: { items: TranscriptItem[] }): JSX.Element {
  return (
    <Static items={items}>
      {(item) => (
        <Box key={item.id} flexDirection="column" marginTop={item.id === 0 ? 0 : 1}>
          <Item item={item} />
        </Box>
      )}
    </Static>
  )
}
