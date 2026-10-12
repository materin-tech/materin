import type { Database } from 'bun:sqlite'

/**
 * Token usage aggregation over assistant message rows (usage JSON column).
 * Period filters run on message.created_at (ms epoch); aggregation happens in
 * JS — per-call volumes are small. model_usage table is a session counter, so
 * messages are the single source of truth for per-call stats.
 */

export type UsagePeriod = 'today' | '7d' | '30d' | 'all'

export interface UsageQuery {
  period: UsagePeriod
  model?: string
  sessionId?: string
}

export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  calls: number
}

export interface UsageModelRow {
  model: string
  input: number
  output: number
  cacheRead: number
  calls: number
}

export interface UsageDayRow {
  day: string // YYYY-MM-DD local
  input: number
  output: number
  calls: number
}

export interface UsageCallRow {
  sessionId: string
  model: string
  input: number
  output: number
  at: number
}

export interface UsageSummary {
  totals: UsageTotals
  byModel: UsageModelRow[]
  byDay: UsageDayRow[]
  recent: UsageCallRow[]
}

const DAY_MS = 86_400_000
const RECENT_LIMIT = 50

interface RawUsageRow {
  session_id: string
  model: string | null
  usage: string
  created_at: number
}

/** Local-midnight for 'today', now - n days for 7d/30d, 0 for 'all'. */
export function periodSinceMs(period: UsagePeriod, now: number = Date.now()): number {
  if (period === 'all') return 0
  if (period === 'today') {
    const d = new Date(now)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  return now - (period === '7d' ? 7 : 30) * DAY_MS
}

function dayKey(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return String(d.getFullYear()) + '-' + mm + '-' + dd
}

function zeroTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, calls: 0 }
}

function addTo(totals: UsageTotals, input: number, output: number, cacheRead: number): void {
  totals.input += input
  totals.output += output
  totals.cacheRead += cacheRead
  totals.calls += 1
}

/** Aggregate assistant-message usage rows into a multi-dimensional summary. */
export function usageSummary(db: Database, q: UsageQuery): UsageSummary {
  const since = periodSinceMs(q.period)
  const where = ["role = 'assistant'", 'usage IS NOT NULL', 'created_at >= ?']
  const params: Array<string | number> = [since]
  if (q.model) {
    where.push('model = ?')
    params.push(q.model)
  }
  if (q.sessionId) {
    where.push('session_id = ?')
    params.push(q.sessionId)
  }
  const rows = db
    .query(
      'SELECT session_id, model, usage, created_at FROM message WHERE ' +
        where.join(' AND ') +
        ' ORDER BY created_at ASC',
    )
    .all(...params) as RawUsageRow[]

  const totals = zeroTotals()
  const models = new Map<string, UsageModelRow>()
  const days = new Map<string, UsageDayRow>()
  const recent: UsageCallRow[] = []
  for (const row of rows) {
    let usage: { input?: number; output?: number; cacheRead?: number }
    try {
      usage = JSON.parse(row.usage) as { input?: number; output?: number; cacheRead?: number }
    } catch {
      continue // corrupt usage JSON — skip the row
    }
    const input = Number(usage.input ?? 0)
    const output = Number(usage.output ?? 0)
    const cacheRead = Number(usage.cacheRead ?? 0)
    addTo(totals, input, output, cacheRead)
    const model = row.model ?? '(unknown)'
    const m = models.get(model) ?? { model: model, input: 0, output: 0, cacheRead: 0, calls: 0 }
    m.input += input
    m.output += output
    m.cacheRead += cacheRead
    m.calls += 1
    models.set(model, m)
    const day = dayKey(row.created_at)
    const d = days.get(day) ?? { day: day, input: 0, output: 0, calls: 0 }
    d.input += input
    d.output += output
    d.calls += 1
    days.set(day, d)
    recent.push({ sessionId: row.session_id, model: model, input: input, output: output, at: row.created_at })
  }

  const byModel = [...models.values()].sort((a, b) => b.input + b.output - (a.input + a.output))
  const byDay = [...days.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  recent.sort((a, b) => b.at - a.at)
  return { totals: totals, byModel: byModel, byDay: byDay, recent: recent.slice(0, RECENT_LIMIT) }
}
