import type { Database } from 'bun:sqlite'

/**
 * FTS5 population + cross-session message search (M3 检索层).
 * 双表策略: fts_trigram 优先 (CJK/子串), 0 命中回退 fts_default.
 * 两表均为 contentless (content=''): 写入走 rowid, snippet 在 JS 侧拼装.
 */

export interface SearchHit {
  sessionId: string
  messageId: string
  snippet: string
  rank: number
}

const SNIPPET_BEFORE = 20
const SNIPPET_AFTER = 30
const SNIPPET_FALLBACK = 60

/** Concatenate all text blocks of a message content array (FTS 索引源). */
export function extractPlainText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string' && text.trim().length > 0) parts.push(text)
    }
  }
  return parts.join('\n')
}

/** Index a message's plain text into both FTS tables (contentless: keyed by message rowid). */
export function ftsIndexMessage(db: Database, messageUid: string, text: string): void {
  const row = db.query('SELECT rowid FROM message WHERE message_uid = ?').get(messageUid) as
    | { rowid: number }
    | null
  if (!row) return
  db.query('INSERT INTO fts_default(rowid, content) VALUES (?, ?)').run(row.rowid, text)
  db.query('INSERT INTO fts_trigram(rowid, content) VALUES (?, ?)').run(row.rowid, text)
}

/** Wrap the query in double quotes so MATCH treats it as a phrase (中文/标点安全). */
function matchPhrase(query: string): string {
  return '"' + query.replace(/"/g, '""') + '"'
}

interface RawSearchRow {
  sessionId: string
  messageId: string
  content: string
  rank: number
}

function queryTable(db: Database, table: 'fts_trigram' | 'fts_default', escaped: string, limit: number): RawSearchRow[] {
  return db
    .query(
      `SELECT m.session_id AS sessionId, m.message_uid AS messageId, m.content AS content, bm25(${table}) AS rank
       FROM ${table} JOIN message m ON m.rowid = ${table}.rowid
       WHERE ${table} MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(escaped, limit) as RawSearchRow[]
}

function buildSnippet(text: string, query: string): string {
  const idx = text.indexOf(query)
  if (idx < 0) return text.slice(0, SNIPPET_FALLBACK)
  const start = Math.max(0, idx - SNIPPET_BEFORE)
  const end = Math.min(text.length, idx + query.length + SNIPPET_AFTER)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end) + suffix
}

/**
 * Search across ALL sessions' messages.
 * trigram 优先 (3+ 字符子串, 含 CJK), 短于 3 字符/分词命中时回退 fts_default.
 * 1-2 字符查询 (如中文单词) 无法命中 trigram, 走 JS 全表扫描回退.
 */
export function searchMessages(db: Database, query: string, opts: { limit?: number } = {}): SearchHit[] {
  const q = query.trim()
  if (q.length === 0) return []
  const limit = opts.limit ?? 10
  if ([...q].length < 3) return shortQueryScan(db, q, limit)
  const escaped = matchPhrase(q)
  let rows: RawSearchRow[] = []
  try {
    rows = queryTable(db, 'fts_trigram', escaped, limit)
    if (rows.length === 0) rows = queryTable(db, 'fts_default', escaped, limit)
  } catch {
    return []
  }
  return rows.map((row) => ({
    sessionId: row.sessionId,
    messageId: row.messageId,
    snippet: buildSnippet(extractPlainText(JSON.parse(row.content)), q),
    rank: row.rank,
  }))
}

interface ScanRow {
  sessionId: string
  messageId: string
  content: string
}

/**
 * LIKE-style fallback for 1-2 char queries: trigram tokenizer requires 3+ chars,
 * so scan message rows in JS instead. Full table scan — fine at current scale;
 * revisit with a char-bigram index if message volume grows.
 */
function shortQueryScan(db: Database, query: string, limit: number): SearchHit[] {
  const rows = db
    .query('SELECT session_id AS sessionId, message_uid AS messageId, content FROM message ORDER BY created_at DESC')
    .all() as ScanRow[]
  const hits: SearchHit[] = []
  for (const row of rows) {
    const text = extractPlainText(JSON.parse(row.content))
    if (!text.includes(query)) continue
    hits.push({ sessionId: row.sessionId, messageId: row.messageId, snippet: buildSnippet(text, query), rank: 0 })
    if (hits.length >= limit) break
  }
  return hits
}
