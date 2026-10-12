import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import type { AssistantContentBlock, AssistantMessage, Message, ToolResultBlock, UserContentBlock, Usage } from '@materin/ai'
import { ftsIndexMessage, extractPlainText, searchMessages, type SearchHit } from './search'

/**
 * Session store — 树形消息历史 (Pi 语义) on SQLite (Hermes 范式).
 * 一次回复 = 从当前 leaf 沿 parent_id 走到根; 分支 = 新消息 parent 指向历史节点.
 */

export interface SessionRow {
  id: string
  parentSessionId: string | null
  projectId: string
  title: string | null
  leafId: string | null
  model: string | null
  thinkingLevel: string
  cwd: string | null
  source: string
  archived: boolean
  createdAt: number
}

export interface MessageRow {
  id: string
  sessionId: string
  parentId: string | null
  seq: number
  role: 'user' | 'assistant' | 'toolResult'
  content: Message['content']
  model: string | null
  provider: string | null
  usage: Usage | null
  stopReason: string | null
  createdAt: number
}

export function projectIdForCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200)
}

function newId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

interface RawMessageRow {
  message_uid: string
  session_id: string
  parent_id: string | null
  seq: number
  role: string
  content: string
  model: string | null
  provider: string | null
  usage: string | null
  stop_reason: string | null
  created_at: number
}

interface RawSessionRow {
  id: string
  parent_session_id: string | null
  project_id: string
  title: string | null
  leaf_id: string | null
  model: string | null
  thinking_level: string
  cwd: string | null
  source: string
  archived: number
  created_at: number
}

export class SessionStore {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  createSession(opts: {
    cwd: string
    model: string
    source?: string
    title?: string
    parentSessionId?: string
  }): SessionRow {
    const id = newId()
    const now = Date.now()
    this.db
      .query(
        `INSERT INTO session (id, parent_session_id, project_id, title, model, cwd, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        opts.parentSessionId ?? null,
        projectIdForCwd(opts.cwd),
        opts.title ?? null,
        opts.model,
        opts.cwd,
        opts.source ?? 'cli',
        now,
      )
    return this.getSession(id)!
  }

  getSession(id: string): SessionRow | null {
    const row = this.db.query('SELECT * FROM session WHERE id = ?').get(id) as RawSessionRow | null
    return row ? mapSession(row) : null
  }

  listSessions(opts: { projectId?: string; includeArchived?: boolean } = {}): SessionRow[] {
    const where: string[] = []
    const params: string[] = []
    if (opts.projectId) {
      where.push('project_id = ?')
      params.push(opts.projectId)
    }
    if (!opts.includeArchived) where.push('archived = 0')
    const sql = `SELECT * FROM session ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`
    return (this.db.query(sql).all(...params) as RawSessionRow[]).map(mapSession)
  }

  setLeaf(sessionId: string, messageId: string): void {
    this.db.query('UPDATE session SET leaf_id = ?, idle_at = ? WHERE id = ?').run(messageId, Date.now(), sessionId)
  }

  getLeaf(sessionId: string): MessageRow | null {
    const session = this.getSession(sessionId)
    if (!session?.leafId) return null
    return this.getMessage(session.leafId)
  }

  getMessage(id: string): MessageRow | null {
    const row = this.db.query('SELECT * FROM message WHERE message_uid = ?').get(id) as RawMessageRow | null
    return row ? mapMessage(row) : null
  }

  appendMessage(
    sessionId: string,
    message:
      | { role: 'user'; content: UserContentBlock[] }
      | { role: 'assistant'; content: AssistantContentBlock[]; model?: string; provider?: string; usage?: Usage; stopReason?: string }
      | { role: 'toolResult'; content: ToolResultBlock[] },
    parentId: string | null,
  ): MessageRow {
    const id = newId()
    const seqRow = this.db
      .query('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM message WHERE session_id = ?')
      .get(sessionId) as { next: number }
    this.db
      .query(
        `INSERT INTO message (message_uid, session_id, parent_id, seq, role, content, model, provider, usage, stop_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sessionId,
        parentId,
        seqRow.next,
        message.role,
        JSON.stringify(message.content),
        message.role === 'assistant' ? (message.model ?? null) : null,
        message.role === 'assistant' ? (message.provider ?? null) : null,
        message.role === 'assistant' && message.usage ? JSON.stringify(message.usage) : null,
        message.role === 'assistant' ? (message.stopReason ?? null) : null,
        Date.now(),
      )
      if (message.role === 'user' || message.role === 'assistant') {
        const text = extractPlainText(message.content)
        if (text.trim().length > 0) ftsIndexMessage(this.db, id, text)
      }
    return this.getMessage(id)!
  }

  /** Cross-session full-text search (FTS5 双表). */
  search(query: string, limit?: number): SearchHit[] {
    return searchMessages(this.db, query, { limit: limit })
  }

  /**
   * Walk the tree from the current leaf up to the root, return root->leaf order.
   * M1: no compaction boundaries yet (M2 adds stop-at-compaction).
   */
  getMessagesToLeaf(sessionId: string): MessageRow[] {
    const leaf = this.getLeaf(sessionId)
    if (!leaf) return []
    const all = this.db
      .query('SELECT * FROM message WHERE session_id = ?')
      .all(sessionId) as RawMessageRow[]
    const byId = new Map(all.map((r) => [r.message_uid, mapMessage(r)]))
    const chain: MessageRow[] = []
    let cur: MessageRow | null = leaf
    const guard = new Set<string>()
    while (cur) {
      if (guard.has(cur.id)) throw new Error(`cycle detected in message tree at ${cur.id}`)
      guard.add(cur.id)
      chain.push(cur)
      cur = cur.parentId ? (byId.get(cur.parentId) ?? null) : null
    }
    return chain.reverse()
  }

  /** Branch: move the leaf pointer to an existing historical message (Pi 原位树分支). */
  branch(sessionId: string, messageId: string): void {
    const msg = this.getMessage(messageId)
    if (!msg || msg.sessionId !== sessionId) {
      throw new Error(`message ${messageId} not found in session ${sessionId}`)
    }
    this.setLeaf(sessionId, messageId)
  }

  setSessionModel(sessionId: string, model: string): void {
    this.db.query('UPDATE session SET model = ? WHERE id = ?').run(model, sessionId)
  }

  setThinkingLevel(sessionId: string, level: string): void {
    this.db.query('UPDATE session SET thinking_level = ? WHERE id = ?').run(level, sessionId)
  }

  addSessionUsage(sessionId: string, usage: Usage, model: string): void {
    this.db
      .query(
        `UPDATE session SET
           tokens_in = tokens_in + ?, tokens_out = tokens_out + ?,
           tokens_cache_read = tokens_cache_read + ?, tokens_cache_write = tokens_cache_write + ?
         WHERE id = ?`,
      )
      .run(usage.input, usage.output, usage.cacheRead ?? 0, usage.cacheWrite ?? 0, sessionId)
    this.db
      .query('INSERT INTO model_usage (session_id, model, input, output, cache_read, cost) VALUES (?, ?, ?, ?, ?, 0)')
      .run(sessionId, model, usage.input, usage.output, usage.cacheRead ?? 0)
  }

  // ---- compaction (append-only: 只追加 checkpoint, 不改写消息树) ----

  addCompaction(input: {
    sessionId: string
    summary: string
    tokensBefore: number
    anchorMessageId: string | null
  }): CompactionRow {
    const id = newId()
    const now = Date.now()
    this.db
      .query(
        `INSERT INTO compaction (id, session_id, summary, tokens_before, anchor_message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.sessionId, input.summary, input.tokensBefore, input.anchorMessageId, now)
    return this.getCompaction(id)!
  }

  getCompaction(id: string): CompactionRow | null {
    const row = this.db.query('SELECT * FROM compaction WHERE id = ?').get(id) as RawCompactionRow | null
    return row ? mapCompaction(row) : null
  }

  /** latest compaction anchor for the session (null if never compacted) */
  compactionAnchor(sessionId: string): string | null {
    const row = this.db
      .query(
        `SELECT anchor_message_id FROM compaction
         WHERE session_id = ? AND anchor_message_id IS NOT NULL
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(sessionId) as { anchor_message_id: string | null } | null
    return row?.anchor_message_id ?? null
  }

  listCompactions(sessionId: string): CompactionRow[] {
    const rows = this.db
      .query('SELECT * FROM compaction WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as RawCompactionRow[]
    return rows.map(mapCompaction)
  }

  /**
   * Context assembly for the LLM: [rules?] + [memory?] + [summary?] + tail chain.
   * anchor 是保留尾部的最老一条消息: 摘要替换 anchor 之前(含)的历史,
   * tail 从 anchor(含)到 leaf 原样保留.
   */
  buildContext(sessionId: string, rulesText?: string, memoryText?: string): Message[] {
    const chain = this.getMessagesToLeaf(sessionId)
    const anchorId = this.compactionAnchor(sessionId)
    let start = 0
    if (anchorId) {
      const idx = chain.findIndex((m) => m.id === anchorId)
      start = idx >= 0 ? idx : 0
    }
    const tail = chain.slice(start)

    const context: Message[] = []
    if (rulesText && rulesText.trim().length > 0) context.push(rulesMessage(rulesText))
    if (memoryText && memoryText.trim().length > 0) context.push(memoryMessage(memoryText))
    if (anchorId && tail.length > 0) {
      const summary = this.latestSummary(sessionId)
      if (summary) context.push(summaryMessage(summary))
    }
    for (const row of tail) context.push(rowToAiMessage(row))
    return context
  }

  // ---- gateway_routing (M4 channels): channel+chat_id+user_id -> session ----

  getRoutingSession(channel: string, chatId: string, userId: string): string | null {
    const row = this.db
      .query('SELECT session_id FROM gateway_routing WHERE channel = ? AND chat_id = ? AND user_id = ?')
      .get(channel, chatId, userId) as { session_id: string } | null
    return row?.session_id ?? null
  }

  setRoutingSession(channel: string, chatId: string, userId: string, sessionId: string): void {
    this.db
      .query(
        `INSERT INTO gateway_routing (channel, chat_id, user_id, session_id, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(channel, chat_id, user_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`,
      )
      .run(channel, chatId, userId, sessionId, Date.now())
  }

  latestSummary(sessionId: string): string | null {
    const row = this.db
      .query('SELECT summary FROM compaction WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(sessionId) as { summary: string } | null
    return row?.summary ?? null
  }
}

export interface CompactionRow {
  id: string
  sessionId: string
  summary: string
  tokensBefore: number | null
  anchorMessageId: string | null
  createdAt: number
}

interface RawCompactionRow {
  id: string
  session_id: string
  summary: string
  tokens_before: number | null
  anchor_message_id: string | null
  created_at: number
}

function mapCompaction(row: RawCompactionRow): CompactionRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    summary: row.summary,
    tokensBefore: row.tokens_before,
    anchorMessageId: row.anchor_message_id,
    createdAt: row.created_at,
  }
}

function rulesMessage(rulesText: string): Message {
  return {
    role: 'user',
    content: [{ type: 'text', text: 'Project rules (AGENTS.md/CLAUDE.md):\n\n' + rulesText }],
  }
}

function summaryMessage(summary: string): Message {
  return {
    role: 'user',
    content: [{ type: 'text', text: '[Earlier conversation summary]\n' + summary }],
  }
}

function memoryMessage(memoryText: string): Message {
  return {
    role: 'user',
    content: [{ type: 'text', text: '[Persistent memory (agent-maintained)]\n' + memoryText }],
  }
}

/** shared neutral-message mapper: DB row -> LLM Message (loop 与 compaction 共用). */
export function rowToAiMessage(row: MessageRow): Message {
  if (row.role === 'assistant') {
    return {
      role: 'assistant',
      content: row.content as AssistantContentBlock[],
      model: row.model ?? undefined,
      usage: row.usage ?? undefined,
      stopReason: row.stopReason ?? undefined,
    }
  }
  return { role: row.role, content: row.content } as Message
}

function mapSession(row: RawSessionRow): SessionRow {
  return {
    id: row.id,
    parentSessionId: row.parent_session_id,
    projectId: row.project_id,
    title: row.title,
    leafId: row.leaf_id,
    model: row.model,
    thinkingLevel: row.thinking_level ?? 'off',
    cwd: row.cwd,
    source: row.source,
    archived: row.archived === 1,
    createdAt: row.created_at,
  }
}

function mapMessage(row: RawMessageRow): MessageRow {
  return {
    id: row.message_uid,
    sessionId: row.session_id,
    parentId: row.parent_id,
    seq: row.seq,
    role: row.role as MessageRow['role'],
    content: JSON.parse(row.content) as Message['content'],
    model: row.model,
    provider: row.provider,
    usage: row.usage ? (JSON.parse(row.usage) as Usage) : null,
    stopReason: row.stop_reason,
    createdAt: row.created_at,
  }
}

export { newId }
