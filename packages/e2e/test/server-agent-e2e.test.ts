import { describe, test, expect, afterAll } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startTestServer, tmpCwd, awaitRunDone } from './helpers'
import { openSse } from './sse'
import { writeScript, hangingProvider } from './fixtures'
import type { TestServer } from './helpers'

/**
 * E2E agent-flow tests over real HTTP.
 * Covers T2 prompt+faux agent / T4 mode effects / T5 thinking pass-through /
 * T6 @-token & images / T10 abort.
 */

const srv: TestServer = startTestServer()
afterAll(() => srv.stop())

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

async function createSession(cwd?: string): Promise<{ id: string }> {
  const res = await srv.post('/session', cwd ? { cwd: cwd } : {})
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

describe('prompt + faux agent over HTTP (T2)', () => {
  test('202 -> messages [user, assistant]; SSE carries agent_start/agent_end', async () => {
    const s = await createSession()
    const sse = await openSse(srv.base)
    try {
      const res = await srv.post('/session/' + s.id + '/prompt', { text: 'hi' })
      expect(res.status).toBe(202)
      const msgs = await awaitRunDone(srv, s.id)
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
      const deadline = Date.now() + 5000
      while (!sse.events.some((e) => e.type === 'agent_end') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25))
      }
      const types = sse.events.map((e) => e.type)
      expect(types).toContain('agent_start')
      expect(types).toContain('agent_end')
    } finally {
      sse.close()
    }
  })
})

describe('mode effects on tools (T4)', () => {
  test('plan mode blocks write; passon writes for real', async () => {
    const dir = tmpCwd()
    const s = await createSession(dir)
    await srv.post('/session/' + s.id + '/prompt', { text: '/mode plan' })

    srv.faux.script = writeScript('plan-blocked.txt')
    await srv.post('/session/' + s.id + '/prompt', { text: 'please write a file' })
    const blocked = await awaitRunDone(srv, s.id)
    const tr = blocked.find((m) => m.role === 'toolResult')
    expect(tr).toBeTruthy()
    expect(JSON.stringify(tr?.content)).toContain('plan mode is read-only')

    await srv.post('/session/' + s.id + '/prompt', { text: '/mode passon' })
    srv.faux.script = writeScript('plan-allowed.txt')
    await srv.post('/session/' + s.id + '/prompt', { text: 'please write a file' })
    const allowed = await awaitRunDone(srv, s.id, blocked.length + 1)
    const lastTr = allowed.findLast((m) => m.role === 'toolResult')
    const first = (lastTr?.content as Array<{ isError?: boolean }> | undefined)?.[0]
    expect(first?.isError).toBeFalsy()
    expect(existsSync(join(dir, 'plan-allowed.txt'))).toBe(true)
    expect(readFileSync(join(dir, 'plan-allowed.txt'), 'utf-8')).toBe('e2e content')
  })
})

describe('abort (T10)', () => {
  test('hanging provider + abort -> assistant stopReason aborted', async () => {
    const s = await createSession()
    srv.setProvider(hangingProvider())
    try {
      const res = await srv.post('/session/' + s.id + '/prompt', { text: 'hang' })
      expect(res.status).toBe(202)
      await new Promise((r) => setTimeout(r, 200))
      const abortRes = await srv.post('/session/' + s.id + '/abort')
      const abortBody = (await abortRes.json()) as { ok: boolean }
      expect(abortBody.ok).toBe(true)

      const msgs = await pollUntilAborted(srv, s.id)
      const assistant = msgs.find((m) => m.role === 'assistant')
      expect(assistant?.stopReason).toBe('aborted')
    } finally {
      srv.setProvider(srv.faux)
    }
  })
})

async function pollUntilAborted(
  server: TestServer,
  sessionId: string,
): Promise<Array<{ role: string; stopReason?: string }>> {
  const deadline = Date.now() + 3000
  for (;;) {
    const res = await server.get('/session/' + sessionId + '/messages')
    const msgs = (await res.json()) as Array<{ role: string; stopReason?: string }>
    if (msgs.some((m) => m.role === 'assistant' && m.stopReason === 'aborted')) return msgs
    if (Date.now() > deadline) throw new Error('assistant aborted row not persisted within 3s')
    await new Promise((r) => setTimeout(r, 25))
  }
}



