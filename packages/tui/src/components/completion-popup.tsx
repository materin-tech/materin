/** Completion popups: @ file candidates + / command candidates (CC style). */

import { Box, Text } from 'ink'
import type { CmdCandidate } from './types'

/** 弹层窗口行数: 固定行数 + 选中项到边缘时窗口滑动 (CC 同款), 上下溢出给提示. */
const POPUP_ROWS = 7

function popupWindow<T>(
  list: T[],
  sel: number,
): { items: Array<{ item: T; i: number }>; start: number; moreUp: boolean; moreDown: boolean } {
  const len = list.length
  const start = Math.max(0, Math.min(sel, Math.max(0, len - POPUP_ROWS)))
  const end = Math.min(len, start + POPUP_ROWS)
  return {
    items: list.slice(start, end).map((item, k) => ({ item: item, i: start + k })),
    start: start,
    moreUp: start > 0,
    moreDown: start + POPUP_ROWS < len,
  }
}

export function FilePopup({ candidates, selIdx }: { candidates: string[]; selIdx: number }): JSX.Element {
  const w = popupWindow(candidates, selIdx)
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {w.moreUp && <Text dimColor>  ↑ 更多…</Text>}
      {w.items.map(({ item: c, i }) => (
        <Text key={c + ':' + String(i)} color={i === selIdx ? 'cyan' : 'gray'}>
          {i === selIdx ? '› ' : '  '}
          {c}
        </Text>
      ))}
      {w.moreDown && <Text dimColor>  ↓ 更多 ({candidates.length - w.start - POPUP_ROWS})</Text>}
    </Box>
  )
}

export function CommandPopup({ candidates, selIdx }: { candidates: CmdCandidate[]; selIdx: number }): JSX.Element {
  const w = popupWindow(candidates, selIdx)
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {w.moreUp && <Text dimColor>  ↑ 更多…</Text>}
      {w.items.map(({ item: c, i }) => (
        <Text key={c.name + ':' + String(i)}>
          <Text color={i === selIdx ? 'cyan' : 'gray'}>
            {i === selIdx ? '› ' : '  '}
            {c.name}
          </Text>
          <Text dimColor>{'  ' + c.description}</Text>
        </Text>
      ))}
      {w.moreDown && <Text dimColor>  ↓ 更多 ({candidates.length - w.start - POPUP_ROWS})</Text>}
    </Box>
  )
}
