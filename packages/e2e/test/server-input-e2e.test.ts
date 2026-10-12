import { describe, test, expect, afterAll } from 'bun:test'
import { startTestServer, awaitRunDone } from './helpers'
import type { TestServer } from './helpers'

/**
 * E2E input-pipeline tests over real HTTP.
 * Covers T5 thinking pass-through / T6 @-token and images.
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

describe('thinking pass-through (T5)', () => {
  test('/thinking high -> provider StreamContext.thinkingLevel === high', async () => {
    const s = await createSession()
    await srv.post('/session/' + s.id + '/prompt', { text: '/thinking high' })
    srv.faux.script = [
      [
        { type: 'text_start', index: 0 },
        { type: 'text_delta', index: 0, delta: 'ok' },
        { type: 'done', usage: { input: 1, output: 2 }, stopReason: 'stop' },
      ],
    ]
    await srv.post('/session/' + s.id + '/prompt', { text: 'answer briefly' })
    await awaitRunDone(srv, s.id)
    expect(srv.faux.contexts.at(-1)?.thinkingLevel).toBe('high')
  })
})

describe('@ input pipeline + images (T6)', () => {
  test('nonexistent @ref keeps raw token; image block round-trips; invalid mime -> 400', async () => {
    const s = await createSession()
    srv.faux.script = [
      [
        { type: 'text_start', index: 0 },
        { type: 'text_delta', index: 0, delta: 'seen' },
        { type: 'done', usage: { input: 1, output: 1 }, stopReason: 'stop' },
      ],
    ]

    await srv.post('/session/' + s.id + '/prompt', { text: 'hello @nonexistent.png' })
    const msgs = await awaitRunDone(srv, s.id)
    const firstText = JSON.stringify(msgs[0]?.content)
    expect(firstText).toContain('hello @nonexistent.png')
    await new Promise((r) => setTimeout(r, 150)) // let the run bookkeeping fully settle

    const res2 = await srv.post('/session/' + s.id + '/prompt', {
      text: 'look',
      images: [{ mimeType: 'image/png', data: PNG_1X1 }],
    })
    expect(res2.status).toBe(202)
    const msgs2 = await awaitRunDone(srv, s.id, msgs.length + 1)
    const latestUser = msgs2.findLast((m) => m.role === 'user')
    const content = (latestUser?.content as Array<{ type: string }>) ?? []
    expect(content[0]?.type).toBe('image')

    const bad = await srv.post('/session/' + s.id + '/prompt', {
      text: 'look',
      images: [{ mimeType: 'application/zip', data: PNG_1X1 }],
    })
    expect(bad.status).toBe(400)
  })
})
