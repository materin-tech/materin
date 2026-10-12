import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { materinHome } from '../config'

/**
 * SQLite schema migrations (Hermes 范式: schema_version 表记录迁移链).
 * v1 — 基础表: session / message(树形) / compaction / FTS5 双表 / 并发治理.
 */

const MIGRATION_V1 = `
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  parent_session_id TEXT,
  project_id TEXT NOT NULL,
  title TEXT,
  leaf_id TEXT,
  model TEXT,
  agent TEXT,
  cwd TEXT,
  git_branch TEXT,
  cost REAL NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'cli',
  archived INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  idle_at INTEGER
);
CREATE INDEX idx_session_project ON session(project_id, archived);

CREATE TABLE message (
  message_uid TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_id TEXT,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  api_content BLOB,
  reasoning TEXT,
  model TEXT,
  provider TEXT,
  usage TEXT,
  stop_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_msg_tree ON message(session_id, parent_id);
CREATE INDEX idx_msg_seq ON message(session_id, seq);

CREATE TABLE compaction (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  tokens_before INTEGER,
  retained_tail TEXT,
  created_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE fts_default USING fts5(
  content, content='', contentless_delete=1, tokenize='unicode61'
);
CREATE VIRTUAL TABLE fts_trigram USING fts5(
  content, content='', contentless_delete=1, tokenize='trigram'
);

CREATE TABLE compression_locks (
  session_id TEXT PRIMARY KEY,
  locked_at INTEGER NOT NULL
);

CREATE TABLE model_usage (
  session_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0
);
`

/// v2 — compaction 增加锚点消息: summary 替换 anchor 之前(含)的历史, tail 从 anchor 开始保留.
const MIGRATION_V2 = `
ALTER TABLE compaction ADD COLUMN anchor_message_id TEXT;
`

/// v3 — gateway 路由表 (M4 channels 预留): channel+chat_id+user_id -> session.
const MIGRATION_V3 = `
CREATE TABLE IF NOT EXISTS gateway_routing (
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (channel, chat_id, user_id)
);
`

/// v4 — 思考深度: session 级设置, 跨 provider 归一化值 ('off'|'low'|'medium'|'high'|'xhigh').
const MIGRATION_V4 = `
ALTER TABLE session ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'off';
`

const MIGRATIONS: string[] = [MIGRATION_V1, MIGRATION_V2, MIGRATION_V3, MIGRATION_V4]

export function defaultDbPath(): string {
  return join(materinHome(), 'state.db')
}

export function openDb(path: string = defaultDbPath()): Database {
  mkdirSync(join(path, '..'), { recursive: true })
  const db = new Database(path, { create: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`)
  const row = db.query('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
  const current = row?.v ?? 0
  for (let v = current + 1; v <= MIGRATIONS.length; v++) {
    db.exec(MIGRATIONS[v - 1]!)
    db.query('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(v, Date.now())
  }
  return db
}
