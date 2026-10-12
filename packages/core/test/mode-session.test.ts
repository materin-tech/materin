import { describe, test, expect } from 'bun:test'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'

describe('permission_mode persistence', () => {
  test('migration v5 applied: schema_version 5, sessions default to manual', () => {
    const db = openDb(':memory:')
    const version = db.query('SELECT MAX(version) AS v FROM schema_version').get() as { v: number }
    expect(version.v).toBe(5)
    const store = new SessionStore(db)
    const session = store.createSession({ cwd: '/tmp/x', model: 'm' })
    expect(session.permissionMode).toBe('manual')
    db.close()
  })

  test('setPermissionMode roundtrip across all modes', () => {
    const db = openDb(':memory:')
    const store = new SessionStore(db)
    const session = store.createSession({ cwd: '/tmp/x', model: 'm' })
    store.setPermissionMode(session.id, 'plan')
    expect(store.getSession(session.id)!.permissionMode).toBe('plan')
    store.setPermissionMode(session.id, 'passon')
    expect(store.getSession(session.id)!.permissionMode).toBe('passon')
    store.setPermissionMode(session.id, 'auto')
    expect(store.getSession(session.id)!.permissionMode).toBe('auto')
    store.setPermissionMode(session.id, 'manual')
    expect(store.getSession(session.id)!.permissionMode).toBe('manual')
    db.close()
  })

  test('junk stored mode normalizes to manual on read', () => {
    const db = openDb(':memory:')
    db.query("UPDATE session SET permission_mode = 'weird' WHERE id = ''").run()
    const store = new SessionStore(db)
    const session = store.createSession({ cwd: '/tmp/x', model: 'm' })
    db.query('UPDATE session SET permission_mode = ? WHERE id = ?').run('weird', session.id)
    expect(store.getSession(session.id)!.permissionMode).toBe('manual')
    db.close()
  })
})
