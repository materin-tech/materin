/** useInput state machine: Shift+Tab mode / Ctrl+C / Esc-abort / @ popup / editing. */

import { useInput } from 'ink'
import type { AtComplete } from './use-file-complete'

export interface InputHandlerDeps {
  runningRef: { current: boolean }
  at: AtComplete
  setInput(updater: (prev: string) => string): void
  submit(): void
  /** 粘贴/合并块内含 \r\n 时: 追加文本并按行提交 (single-line input). */
  submitPaste(text: string): void
  cycleMode(): void
  abort(): void
  onExit(): void
}

export function useInputHandlers(deps: InputHandlerDeps): void {
  useInput((chunk, key) => {
    if (key.tab && key.shift) {
      deps.cycleMode()
      return
    }
    if (chunk === 'c' && key.ctrl) {
      if (deps.runningRef.current) deps.abort()
      else deps.onExit()
      return
    }
    if (deps.runningRef.current) {
      if (key.escape) deps.abort()
      return
    }
    if (key.return || chunk === '\n') {
      if (deps.at.isOpen) deps.setInput(() => deps.at.apply())
      else deps.submit()
      return
    }
    if (/[\r\n]/.test(chunk)) {
      // 多键合并到达 (Ink parseKeypress 只解析单键): 内嵌回车 → 提交
      deps.submitPaste(chunk.replace(/[\r\n]/g, ''))
      return
    }
    if (key.escape) {
      deps.at.dismiss()
      return
    }
    if (key.tab) {
      if (deps.at.isOpen) deps.setInput(() => deps.at.apply())
      return
    }
    if (key.upArrow && deps.at.isOpen) {
      deps.at.move(-1)
      return
    }
    if (key.downArrow && deps.at.isOpen) {
      deps.at.move(1)
      return
    }
    if (key.delete) {
      deps.setInput((s) => Array.from(s).slice(0, -1).join(''))
      return
    }
    if (key.upArrow || key.downArrow || key.leftArrow || key.pageUp || key.pageDown || key.ctrl || key.meta) return
    if (chunk.length > 0) deps.setInput((s) => s + chunk)
  })
}
