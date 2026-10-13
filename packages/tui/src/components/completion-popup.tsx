/** Completion popups: @ file candidates + / command candidates (CC style). */

import { Box, Text } from 'ink'
import type { CmdCandidate } from './types'

export function FilePopup({ candidates, selIdx }: { candidates: string[]; selIdx: number }): JSX.Element {
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

export function CommandPopup({ candidates, selIdx }: { candidates: CmdCandidate[]; selIdx: number }): JSX.Element {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {candidates.map((c, i) => (
        <Text key={c.name + ':' + String(i)}>
          <Text color={i === selIdx ? 'cyan' : 'gray'}>
            {i === selIdx ? '› ' : '  '}
            {c.name}
          </Text>
          <Text dimColor>{'  ' + c.description}</Text>
        </Text>
      ))}
    </Box>
  )
}
