/**
 * TUI 事件渲染 — Claude Code 式排版:
 *   [thinking] 暗色思考流 → 正文 → ⏺ 工具行 → 回合间空行.
 */

const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const RED = '\x1b[31m'
const R = '\x1b[0m'

let thinkingOpen = false
let textOpen = false

function resetTurn(): void {
  thinkingOpen = false
  textOpen = false
}

export function renderEvent(ev: {
  type: string
  delta?: { type: 'text' | 'thinking'; text: string }
  tool?: string
  argsPreview?: string
  isError?: boolean
  preview?: string
  error?: string
}): void {
  switch (ev.type) {
    case 'agent_start':
      resetTurn()
      break

    case 'message_update': {
      if (!ev.delta) break
      if (ev.delta.type === 'thinking' && ev.delta.text) {
        if (!thinkingOpen) {
          process.stdout.write('\n' + DIM + '· thinking · ' + R + DIM)
          thinkingOpen = true
          textOpen = false
        }
        process.stdout.write(ev.delta.text + R)
        break
      }
      if (ev.delta.type === 'text' && ev.delta.text) {
        if (!textOpen) {
          process.stdout.write('\n')
          textOpen = true
          thinkingOpen = false
        }
        process.stdout.write(ev.delta.text)
      }
      break
    }

    case 'tool_execution_start':
      thinkingOpen = false
      textOpen = false
      process.stdout.write('\n' + CYAN + '⏺ ' + ev.tool + R + '(' + DIM + ev.argsPreview + R + ')\n')
      break

    case 'tool_execution_end':
      if (ev.isError) process.stdout.write('  ' + RED + '⎿ error: ' + (ev.preview ?? '') + R + '\n')
      else process.stdout.write('  ' + DIM + '⎿ ' + (ev.preview || 'done') + R + '\n')
      break

    case 'agent_end':
      process.stdout.write('\n\n')
      resetTurn()
      break

    case 'agent_error':
      process.stdout.write('\n' + RED + 'error: ' + (ev.error ?? '') + R + '\n\n')
      resetTurn()
      break
  }
}
