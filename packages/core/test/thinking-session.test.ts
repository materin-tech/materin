import { describe, test, expect } from 'bun:test'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'
import { normalizeThinking } from '@materin/ai'

describe('thinking_level persistence', () => {
  test('migration v4 applied: schema_version 4, sessions default to off', () => {
    const db = openDb(':memory:')
    const version = db.query('SELECT MAX(version) AS v FROM schema_version').get() as { v: number }
    expect(version.v).toBe(4)
    const store = new SessionStore(db)
    const session = store.createSession({ cwd: '/tmp/x', model: 'm' })
    expect(session.thinkingLevel).toBe('off')
    db.close()
  })

  test('setThinkingLevel roundtrip', () => {
    const db = openDb(':memory:')
    const store = new SessionStore(db)
    const session = store.createSession({ cwd: '/tmp/x', model: 'm' })
    store.setThinkingLevel(session.id, 'high')
    expect(store.getSession(session.id)!.thinkingLevel).toBe('high')
    store.setThinkingLevel(session.id, 'off')
    expect(store.getSession(session.id)!.thinkingLevel).toBe('off')
    db.close()
  })

  test('normalizeThinking maps junk to off (server boundary defense)', () => {
    expect(normalizeThinking('garbage')).toBe('off')
    expect(normalizeThinking(undefined)).toBe('off')
  })
})
