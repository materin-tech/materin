import type { Database } from 'bun:sqlite'
import { usageSummary, type SessionStore, type UsagePeriod, type UsageSummary } from '@materin/core'
import type { Context } from 'hono'

/**
 * /token command: per-call session detail (no arg) or a global multi-day
 * summary via usageSummary (today|7d|30d|all). Formatting only — the registry
 * entry in commands.ts stays a one-liner.
 */

export const TOKEN_PERIODS: readonly string[] = ['today', '7d', '30d', 'all']

const fmtUsage = (input: number, output: number, cacheRead: number): string =>
  'input=' + input + ' output=' + output + ' cache=' + cacheRead

interface TokenDeps {
  store: SessionStore
  getDb?: () => Database
}

/** /token handler: current-session detail without arg, global summary with one. */
export async function runTokenCommand(
  ctx: TokenDeps,
  c: Context,
  sessionId: string,
  arg?: string,
): Promise<Response> {
  const period = (arg ?? '').trim().toLowerCase()
  if (!ctx.getDb) return c.json({ command: true, error: 'usage db not configured' }, 500)
  if (period.length === 0) {
    const session = ctx.store.getSession(sessionId)
    if (!session) return c.json({ error: 'not found' }, 404)
    return c.json({ command: true, output: formatSessionDetail(ctx.store, sessionId) })
  }
  if (!(TOKEN_PERIODS as readonly string[]).includes(period)) {
    return c.json({
      command: true,
      error: 'invalid period',
      output: 'usage: /token <today|7d|30d|all> (无参 = 当前会话逐次调用明细)',
    })
  }
  const summary = usageSummary(ctx.getDb(), { period: period as UsagePeriod })
  return c.json({ command: true, output: formatGlobalSummary(summary) })
}

/** Current-session view: one line per assistant message carrying usage. */
function formatSessionDetail(store: SessionStore, sessionId: string): string {
  const chain = store.getMessagesToLeaf(sessionId)
  const lines: string[] = []
  let input = 0
  let output = 0
  let cache = 0
  for (const m of chain) {
    if (!m.usage) continue
    input += m.usage.input
    output += m.usage.output
    cache += m.usage.cacheRead ?? 0
    lines.push('#' + m.seq + ' ' + (m.model ?? '(unknown)') + ' ' + fmtUsage(m.usage.input, m.usage.output, m.usage.cacheRead ?? 0))
  }
  if (lines.length === 0) return '(当前会话暂无 token 记录)'
  lines.push('total: ' + fmtUsage(input, output, cache) + ' calls=' + lines.length)
  return lines.join('\n')
}

/** Global view: totals + byModel + byDay tables. */
export function formatGlobalSummary(summary: UsageSummary): string {
  const lines: string[] = []
  lines.push(
    'total: ' +
      fmtUsage(summary.totals.input, summary.totals.output, summary.totals.cacheRead) +
      ' calls=' +
      String(summary.totals.calls),
  )
  lines.push('byModel:')
  if (summary.byModel.length === 0) lines.push('  (none)')
  for (const m of summary.byModel) {
    lines.push('  ' + m.model + ' ' + fmtUsage(m.input, m.output, m.cacheRead) + ' calls=' + String(m.calls))
  }
  lines.push('byDay:')
  if (summary.byDay.length === 0) lines.push('  (none)')
  for (const d of summary.byDay) {
    lines.push('  ' + d.day + ' input=' + d.input + ' output=' + d.output + ' calls=' + String(d.calls))
  }
  return lines.join('\n')
}
