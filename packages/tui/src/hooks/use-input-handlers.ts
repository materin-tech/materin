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
  toggleVerbose(): void
  onHistoryUp(): void
  onHistoryDown(): void
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
    if (key.escape && deps.runningRef.current) {
      deps.abort()
      return
    }
    if (chunk === 'o' && key.ctrl) {
      deps.toggleVerbose()
      return
    }
    if (key.return || chunk === '\n') {
      if (deps.at.isOpen) deps.setInput(() => deps.at.apply())
      else deps.submit()
      return
    }
    if (/[\r\n]/.test(chunk)) {
      // 多键合并到达 (Ink parseKeypress 只解析单键): 按内嵌回车拆行, 逐行追加+提交
      const segments = chunk.split(/[\r\n]+/).filter((seg) => seg.length > 0)
      for (const seg of segments) {
        deps.setInput((s) => s + seg)
        deps.submit()
      }
      if (segments.length === 0) deps.submit()
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
    if (key.upArrow) {
      if (deps.at.isOpen) deps.at.move(-1)
      else deps.onHistoryUp()
      return
    }
    if (key.downArrow) {
      if (deps.at.isOpen) deps.at.move(1)
      else deps.onHistoryDown()
      return
    }
    if (key.delete) {
      deps.setInput((s) => Array.from(s).slice(0, -1).join(''))
      return
    }
    if (chunk.includes('\x7f') || chunk.includes('\b')) {
      // 合并到达的连发退格 (parseKeypress 只解析单键): 删 n 个字符, 余下文本追加
      const rest = chunk.replace(/[\x7f\b]/g, '')
      const n = chunk.length - rest.length
      deps.setInput((s) => {
        const kept = Array.from(s).slice(0, Math.max(0, Array.from(s).length - n)).join('')
        return kept + rest
      })
      return
    }
    if (key.upArrow || key.downArrow || key.leftArrow || key.pageUp || key.pageDown || key.ctrl || key.meta) return
    if (chunk.length > 0) deps.setInput((s) => s + chunk)
  })
}
