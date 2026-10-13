import { describe, test, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startTestServer, tmpCwd, type TestServer } from './helpers'

/**
 * E2E tests for the slash-command registry + new endpoints:
 * /help /status /skills /memory /search /branch /clear /version /extensions,
 * DELETE /session/:id, GET/POST /config (masked, no keys returned).
 *
 * MATERIN_HOME is pointed at a tmpdir so POST /config writes an isolated
 * config.json instead of touching the developer's real ~/.materin.
 */

const testHome = mkdtempSync(join(tmpdir(), 'materin-cmd-e2e-'))
process.env.MATERIN_HOME = testHome

const srv: TestServer = startTestServer()
afterAll(() => {
  srv.stop()
  rmSync(testHome, { recursive: true, force: true })
})

async function createSession(cwd?: string): Promise<{ id: string }> {
  const res = await srv.post('/session', cwd ? { cwd: cwd } : {})
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

interface CommandRes {
  command?: boolean
  output?: string
  sessionId?: string
  error?: string
}

async function runCommand(sid: string, text: string): Promise<CommandRes> {
  const res = await srv.post('/session/' + sid + '/prompt', { text: text })
  const body = (await res.json()) as CommandRes
  return body
}

describe('slash command registry (A)', () => {
  test('/help lists builtin commands incl /status', async () => {
    const s = await createSession()
    const body = await runCommand(s.id, '/help')
    expect(body.command).toBe(true)
    expect(body.output).toContain('/status')
    expect(body.output).toContain('/help')
  })

  test('/help <cmd> shows one spec', async () => {
    const s = await createSession()
    const body = await runCommand(s.id, '/help mode')
    expect(body.output).toContain('/mode')
    expect(body.output).toContain('plan|manual|auto|passon')
  })

  test('/status shows model:, thinking, mode, tokens, message count', async () => {
    const s = await createSession()
    const body = await runCommand(s.id, '/status')
    expect(body.command).toBe(true)
    expect(body.output).toContain('model:')
    expect(body.output).toContain('thinking: ')
    expect(body.output).toContain('mode: ')
    expect(body.output).toContain('messages: 0')
    expect(body.output).toContain('tokens: 0 in / 0 out')
  })

  test('/skills runs and lists or reports none', async () => {
    const dir = tmpCwd()
    const s = await createSession(dir)
    const body = await runCommand(s.id, '/skills')
    expect(body.command).toBe(true)
    expect(typeof body.output).toBe('string')
    expect(body.output!.length).toBeGreaterThan(0)
  })

  test('/memory returns (empty) snapshot or content', async () => {
    const s = await createSession()
    const body = await runCommand(s.id, '/memory')
    expect(body.command).toBe(true)
    expect(['(empty)']).toContain(body.output ?? '')
  })

  test('/search returns formatted [sid] lines; usage error without query', async () => {
    const s = await createSession()
    const m = srv.store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'command e2e search token zzcmdsearchzz' }] }, null)
    srv.store.setLeaf(s.id, m.id)
    const body = await runCommand(s.id, '/search zzcmdsearchzz')
    expect(body.output!).toContain('[' + s.id + ']')
    expect(body.output!).toContain('zzcmdsearchzz')

    const empty = await runCommand(s.id, '/search')
    expect(empty.output).toContain('usage: /search')
  })

  test('/branch lists last messages; with id branches', async () => {
    const s = await createSession()
    const m1 = srv.store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'branch-list msg one' }] }, null)
    const m2 = srv.store.appendMessage(s.id, { role: 'assistant', content: [{ type: 'text', text: 'branch-list reply two' }] }, m1.id)
    srv.store.setLeaf(s.id, m2.id)

    const list = await runCommand(s.id, '/branch')
    expect(list.output).toContain(m1.id)
    expect(list.output).toContain(m2.id)
    expect(list.output).toContain('user')
    expect(list.output).toContain('assistant')

    const m0 = srv.store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'later msg' }] }, m2.id)
    srv.store.setLeaf(s.id, m0.id)
    const branched = await runCommand(s.id, '/branch ' + m1.id)
    expect(branched.output).toBe('branched to ' + m1.id)
    const chain = (await (await srv.get('/session/' + s.id + '/messages')).json()) as Array<{ id: string }>
    expect(chain.map((x) => x.id)).toEqual([m1.id])
  })

  test('/clear creates a fresh session (same cwd/model) and /new creates one', async () => {
    const dir = tmpCwd()
    const s = await createSession(dir)
    await srv.post('/session/' + s.id + '/mode', { mode: 'plan' })
    const cleared = await runCommand(s.id, '/clear')
    expect(cleared.command).toBe(true)
    expect(cleared.sessionId).toBeTruthy()
    expect(cleared.sessionId).not.toBe(s.id)
    expect(cleared.output).toContain('上下文已清空')
    const fresh = (await (await srv.get('/session/' + cleared.sessionId!)).json()) as { cwd: string; permissionMode: string }
    expect(fresh.cwd).toBe(dir)
    expect(fresh.permissionMode).toBe('manual') // fresh start: mode not inherited

    const created = await runCommand(s.id, '/new')
    expect(created.sessionId).toBeTruthy()
    expect(created.sessionId).not.toBe(s.id)
  })

  test('/version contains materin; /extensions runs; /bogus still unknown', async () => {
    const s = await createSession()
    const version = await runCommand(s.id, '/version')
    expect(version.output).toContain('materin ')

    const ext = await runCommand(s.id, '/extensions')
    expect(ext.command).toBe(true)
    expect(typeof ext.output).toBe('string')

    const bogus = await runCommand(s.id, '/bogus')
    expect(bogus.error).toContain('unknown command')
  })
})

describe('session deletion (B2)', () => {
  test('DELETE /session/:id removes session + messages; 404 unknown', async () => {
    const s = await createSession()
    srv.store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'to be deleted deltoken123' }] }, null)
    const del = await srv.del('/session/' + s.id)
    expect(del.status).toBe(200)
    expect(((await del.json()) as { ok: boolean }).ok).toBe(true)

    expect((await srv.get('/session/' + s.id)).status).toBe(404)
    const list = (await (await srv.get('/session')).json()) as Array<{ id: string }>
    expect(list.some((x) => x.id === s.id)).toBe(false)
    const hits = (await (await srv.get('/search?q=deltoken123')).json()) as Array<{ sessionId: string }>
    expect(hits.some((h) => h.sessionId === s.id)).toBe(false)

    const missing = await srv.del('/session/nope-123')
    expect(missing.status).toBe(404)
  })
})

describe('GET /commands (autocomplete)', () => {
  test('returns >=15 commands, each with name+description', async () => {
    const res = await srv.get('/commands')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { commands: Array<{ name: string; description: string; usage?: string; source?: string }> }
    expect(body.commands.length).toBeGreaterThanOrEqual(15)
    for (const cmd of body.commands) {
      expect(cmd.name.startsWith('/')).toBe(true)
      expect(typeof cmd.description).toBe('string')
      expect(cmd.description.length).toBeGreaterThan(0)
    }
    expect(body.commands.some((c) => c.name === '/token')).toBe(true)
    expect(body.commands.some((c) => c.name === '/help')).toBe(true)
  })
})

describe('config endpoints (B4)', () => {
  test('GET /config returns masked provider view with hasKey flags, never keys', async () => {
    const res = await srv.get('/config')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { defaultModel: string | null; providers: Record<string, { hasKey: boolean; baseUrl?: string }> }
    expect(Object.keys(body.providers).sort()).toEqual(['anthropic', 'deepseek', 'glm', 'kimi', 'openai', 'qwen'])
    for (const entry of Object.values(body.providers)) {
      expect(typeof entry.hasKey).toBe('boolean')
      expect(entry).not.toHaveProperty('apiKey')
    }
    expect(JSON.stringify(body)).not.toContain('"apiKey"')
  })

  test('POST /config merges provider key and GET shows hasKey: true', async () => {
    const post = await srv.post('/config', { providers: { deepseek: { apiKey: 'sk-cmd-e2e-test' } } })
    expect(post.status).toBe(200)
    const masked = (await post.json()) as { providers: Record<string, { hasKey: boolean }> }
    expect(masked.providers.deepseek!.hasKey).toBe(true)

    const get = (await (await srv.get('/config')).json()) as { providers: Record<string, { hasKey: boolean }> }
    expect(get.providers.deepseek!.hasKey).toBe(true)
  })

  test('POST /config rejects unknown providers; unknown provider id ignored', async () => {
    const post = await srv.post('/config', { providers: { 'not-a-provider': { apiKey: 'sk-x' } } })
    expect(post.status).toBe(200)
    const masked = (await post.json()) as { providers: Record<string, { hasKey: boolean }> }
    expect(masked.providers['not-a-provider']).toBeUndefined()
  })
})
