/**
 * Permission rules: allow / ask / deny, last-match-wins.
 * M2 默认放行; doom-loop 检测: 连续 3 次相同调用强制 ask.
 */

export type PermissionAction = 'allow' | 'ask' | 'deny'

export interface PermissionRule {
  tool: string
  /** glob-ish target pattern, '*' matches anything; target 依工具而定 */
  pattern?: string
  action: PermissionAction
}

export type PermissionDecision = PermissionAction

const DOOM_LOOP_REPEATS = 3

export class PermissionManager {
  private readonly rules: PermissionRule[]
  private lastKey: string | null = null
  private repeatCount = 0

  constructor(rules: PermissionRule[] = []) {
    this.rules = rules
  }

  /** must be called before check() for every intended tool call */
  record(tool: string, args: unknown): void {
    const key = callKey(tool, args)
    if (key === this.lastKey) {
      this.repeatCount += 1
    } else {
      this.lastKey = key
      this.repeatCount = 1
    }
  }

  check(tool: string, args: unknown): PermissionDecision {
    if (this.isDoomLoop(tool, args)) return 'ask'
    let decision: PermissionDecision = 'allow'
    const target = targetOf(tool, args)
    for (const rule of this.rules) {
      if (rule.tool !== tool) continue
      if (rule.pattern != null && !wildcardMatch(rule.pattern, target)) continue
      decision = rule.action
    }
    return decision
  }

  private isDoomLoop(tool: string, args: unknown): boolean {
    return this.repeatCount >= DOOM_LOOP_REPEATS && this.lastKey === callKey(tool, args)
  }
}

function callKey(tool: string, args: unknown): string {
  return tool + '|' + stableJson(args)
}

function stableJson(args: unknown): string {
  try {
    return JSON.stringify(args ?? null)
  } catch {
    return '(unserializable)'
  }
}

/** bash -> args.command; 文件类工具 -> args.file_path; 其它 -> JSON */
export function targetOf(tool: string, args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>
  if (tool === 'bash' && typeof record.command === 'string') return record.command
  if (typeof record.file_path === 'string') return record.file_path
  return stableJson(args)
}

/** '*' 通配; 其余字符按字面匹配, 无正则注入面. */
export function wildcardMatch(pattern: string, target: string): boolean {
  let regex = ''
  for (const ch of pattern) {
    if (ch === '*') {
      regex += '.*'
    } else {
      regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp('^' + regex + '$').test(target)
}

/** M2 env format: "tool:action[:pattern];tool:action[:pattern]" e.g. "bash:deny:rm *;bash:allow:*" */
export function parsePermissionRules(raw: string | undefined): PermissionRule[] {
  const trimmed = (raw ?? '').trim()
  if (trimmed.length === 0) return []
  const rules: PermissionRule[] = []
  for (const part of trimmed.split(';')) {
    const entry = part.trim()
    if (entry.length === 0) continue
    const pieces = entry.split(':')
    const tool = pieces[0] ?? ''
    const action = pieces[1] ?? ''
    if (tool.length === 0) continue
    if (action !== 'allow' && action !== 'ask' && action !== 'deny') continue
    const pattern = pieces.slice(2).join(':')
    rules.push({ tool: tool, pattern: pattern.length > 0 ? pattern : undefined, action: action })
  }
  return rules
}
