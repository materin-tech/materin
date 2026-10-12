import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

/**
 * 策展记忆层 (M3): 有界 MEMORY.md (2200 字符硬限) + 主题文件按需读.
 * 超限报错逼整理 (强制编辑, 不自动压缩); 注入用冻结快照保 prompt cache.
 */

export const MEMORY_LIMIT = 2200
const MEMORY_FILE = 'MEMORY.md'

export type MemoryApplyResult = { ok: true } | { ok: false; error?: string; overBy?: number }

export interface MemoryOperation {
  action: 'add' | 'replace' | 'remove'
  find?: string
  text?: string
}

export class MemoryStore {
  private readonly memoryPath: string

  constructor(memDir: string) {
    this.memoryPath = join(memDir, MEMORY_FILE)
  }

  /** Frozen-snapshot read for context injection ('' if MEMORY.md is missing). */
  readSnapshot(): string {
    try {
      return readFileSync(this.memoryPath, 'utf-8')
    } catch {
      return ''
    }
  }

  private current(): string {
    try {
      return readFileSync(this.memoryPath, 'utf-8')
    } catch {
      return ''
    }
  }

  /**
   * Validate-then-apply: nothing is written unless ALL operations validate and
   * the result stays within MEMORY_LIMIT (超限报错逼整理).
   */
  async apply(operations: MemoryOperation[]): Promise<MemoryApplyResult> {
    let text = this.current()
    for (const op of operations) {
      const applied = applyOne(text, op)
      if ('error' in applied) return { ok: false, error: applied.error }
      text = applied.text
    }
    if (text.length > MEMORY_LIMIT) {
      return { ok: false, overBy: text.length - MEMORY_LIMIT }
    }
    try {
      mkdirSync(dirname(this.memoryPath), { recursive: true })
      writeFileSync(this.memoryPath, text)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

/** Pure single-operation transform on the working text. */
function applyOne(text: string, op: MemoryOperation): { text: string } | { error: string } {
  if (op.action === 'add') {
    if (typeof op.text !== 'string') return { error: 'add requires text' }
    return { text: text.length > 0 ? text + '\n' + op.text : op.text }
  }
  if (op.action === 'replace') {
    if (typeof op.find !== 'string') return { error: 'replace requires find' }
    const count = countOccurrences(text, op.find)
    if (count === 0) return { error: 'replace: substring not found: ' + JSON.stringify(op.find.slice(0, 80)) }
    if (count > 1) return { error: 'replace: substring occurs ' + count + ' times, must be unique: ' + JSON.stringify(op.find.slice(0, 80)) }
    return { text: text.replace(op.find, op.text ?? '') }
  }
  if (op.action === 'remove') {
    if (typeof op.find !== 'string') return { error: 'remove requires find' }
    const count = countOccurrences(text, op.find)
    if (count === 0) return { error: 'remove: substring not found: ' + JSON.stringify(op.find.slice(0, 80)) }
    if (count > 1) return { error: 'remove: substring occurs ' + count + ' times, must be unique: ' + JSON.stringify(op.find.slice(0, 80)) }
    return { text: text.replace(op.find, '') }
  }
  return { error: 'unknown memory action: ' + String(op.action) }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx >= 0) {
    count += 1
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}
