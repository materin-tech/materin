import { describe, test, expect, afterAll } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { startTestServer, tmpCwd, type TestServer } from './helpers'

/**
 * E2E API tests over real HTTP.
 * Covers T1 lifecycle / T3 commands / T7 search / T8 files / T9 static UI.
 * Each test creates its own session; data is independent.
 */

const srv: TestServer = startTestServer()
afterAll(() => srv.stop())

async function createSession(cwd?: string): Promise<{ id: string }> {
  const res = await srv.post('/session', cwd ? { cwd: cwd } : {})
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

describe('session lifecycle (T1)', () => {
  test('POST /session -> 201; list; roundtrip; 404 unknown', async () => {
    const created = await createSession('/tmp/materin-e2e-t1')
    expect(created.id).toBeTruthy()

    const list = (await (await srv.get('/session')).json()) as Array<{ id: string }>
    expect(Array.isArray(list)).toBe(true)
    expect(list.some((s) => s.id === created.id)).toBe(true)

    const got = (await (await srv.get('/session/' + created.id)).json()) as { id: string; model: string; permissionMode: string }
    expect(got.id).toBe(created.id)
    expect(got.model).toBe('claude-sonnet-5-5')
    expect(got.permissionMode).toBe('manual')

    const missing = await srv.get('/session/does-not-exist')
    expect(missing.status).toBe(404)
  })
})

describe('command handling (T3)', () => {
  test('/model sonnet -> canonical id persisted', async () => {
    const s = await createSession()
    const res = await srv.post('/session/' + s.id + '/prompt', { text: '/model sonnet' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { command: boolean; model: string }
    expect(body.command).toBe(true)
    expect(body.model).toBe('claude-sonnet-5-5')
    const session = (await (await srv.get('/session/' + s.id)).json()) as { model: string }
    expect(session.model).toBe('claude-sonnet-5-5')
  })

  test('/thinking high -> session.thinkingLevel high', async () => {
    const s = await createSession()
    const res = await srv.post('/session/' + s.id + '/prompt', { text: '/thinking high' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { command: boolean; thinkingLevel: string }
    expect(body.command).toBe(true)
    expect(body.thinkingLevel).toBe('high')
    const session = (await (await srv.get('/session/' + s.id)).json()) as { thinkingLevel: string }
    expect(session.thinkingLevel).toBe('high')
  })

  test('/mode passon and /plan set permissionMode', async () => {
    const s = await createSession()
    const res = await srv.post('/session/' + s.id + '/prompt', { text: '/mode passon' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { command: boolean; session: { permissionMode: string } }
    expect(body.command).toBe(true)
    expect(body.session.permissionMode).toBe('passon')

    await srv.post('/session/' + s.id + '/prompt', { text: '/plan' })
    const session = (await (await srv.get('/session/' + s.id)).json()) as { permissionMode: string }
    expect(session.permissionMode).toBe('plan')
  })

  test('/bogus -> 400 unknown command', async () => {
    const s = await createSession()
    const res = await srv.post('/session/' + s.id + '/prompt', { text: '/bogus' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { command: boolean; error: string }
    expect(body.command).toBe(true)
    expect(body.error).toContain('unknown command')
  })

  test('/new -> 201 with a new session id', async () => {
    const s = await createSession()
    const res = await srv.post('/session/' + s.id + '/prompt', { text: '/new' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { command: boolean; sessionId: string }
    expect(body.command).toBe(true)
    expect(body.sessionId).not.toBe(s.id)
  })
})

describe('search (T7)', () => {
  test('GET /search returns hits including 2-char Chinese; session-scoped too', async () => {
    const s = await createSession()
    const leaf = srv.store.getLeaf(s.id)
    srv.store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'e2e 检索样例 unique-t7-token' }] }, leaf ? leaf.id : null)

    const hits = (await (await srv.get('/search?q=' + encodeURIComponent('检索'))).json()) as Array<{ sessionId: string; messageId: string }>
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits.some((h) => h.sessionId === s.id)).toBe(true)

    const scoped = (await (await srv.get('/session/' + s.id + '/search?q=' + encodeURIComponent('检索'))).json()) as Array<{ sessionId: string }>
    expect(scoped.some((h) => h.sessionId === s.id)).toBe(true)
  })
})

describe('files listing (T8)', () => {
  test('GET /session/:id/files?q= returns matching files', async () => {
    const dir = tmpCwd()
    writeFileSync(join(dir, 'alpha-e2e.txt'), 'a')
    writeFileSync(join(dir, 'beta-e2e.md'), 'b')

    const s = await createSession(dir)
    const res = await srv.get('/session/' + s.id + '/files?q=alpha')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { files: string[] }
    expect(Array.isArray(body.files)).toBe(true)
    expect(body.files.some((f) => f.includes('alpha-e2e.txt'))).toBe(true)
  })
})

describe('static UI + openapi (T9)', () => {
  test('GET /openapi.json -> 200 with paths object', async () => {
    const res = await srv.get('/openapi.json')
    expect(res.status).toBe(200)
    const spec = (await res.json()) as { paths: Record<string, unknown> }
    expect(typeof spec.paths).toBe('object')
    expect(Object.keys(spec.paths).length).toBeGreaterThan(5)
  })

  test('GET /ui/ serves built web SPA (skips gracefully if dist missing)', async () => {
    const webRoot = process.env.MATERIN_WEB_ROOT ?? join(import.meta.dir, '../../web/dist')
    if (!existsSync(join(webRoot, 'index.html'))) {
      const build = spawnSync('bun', ['run', 'web:build'], { cwd: join(import.meta.dir, '../..'), stdio: 'ignore', timeout: 120_000 })
      if (build.status !== 0 || !existsSync(join(webRoot, 'index.html'))) {
        console.warn('[e2e] packages/web/dist missing and build failed — skipping /ui/ assertion')
        return
      }
    }
    const res = await srv.get('/ui/')
    expect(res.status).toBe(200)
    expect((res.headers.get('content-type') ?? '').startsWith('text/html')).toBe(true)
  })
})
