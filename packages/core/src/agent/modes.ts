/**
 * 审批模式 (对齐 Claude Code 权限模式, Shift+Tab 循环):
 *   plan   — 只读: edit/write 拒绝, bash/task 询问
 *   manual — 默认: 规则判定, 未匹配的危险工具询问
 *   auto   — 自动批准: 未匹配规则一律放行 (doom-loop 仍拦截)
 *   passon — 直通 (bypass): 一律放行, 仅显式 deny 规则仍生效
 */

export type PermissionMode = 'plan' | 'manual' | 'auto' | 'passon'

export const MODE_CYCLE: PermissionMode[] = ['manual', 'auto', 'plan', 'passon']

const WRITE_TOOLS = ['edit', 'write']
const READ_TOOLS = ['read', 'session_search', 'skill', 'memory', 'task']

export function normalizeMode(input?: string | null): PermissionMode {
  const v = (input ?? '').toLowerCase()
  if (v === 'plan' || v === 'manual' || v === 'auto' || v === 'passon') return v
  return 'manual'
}

export function nextMode(current: string): PermissionMode {
  const idx = MODE_CYCLE.indexOf(normalizeMode(current))
  return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length]!
}

/**
 * 规则判定 (PermissionManager.check 输出) + 模式 -> 最终决策.
 * 显式 deny 规则在所有模式生效 (用户显式配置 > 模式).
 */
export function resolveToolDecision(
  mode: PermissionMode,
  tool: string,
  ruleDecision: 'allow' | 'ask' | 'deny',
): 'allow' | 'ask' | 'deny' {
  if (ruleDecision === 'deny') return 'deny'
  if (mode === 'plan') {
    if (WRITE_TOOLS.includes(tool)) return 'deny'
    if (ruleDecision === 'allow' || READ_TOOLS.includes(tool)) return 'allow'
    return 'ask'
  }
  if (mode === 'passon') return 'allow'
  if (mode === 'auto') return ruleDecision === 'ask' ? 'allow' : ruleDecision
  return ruleDecision
}
