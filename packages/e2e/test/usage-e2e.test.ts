import { describe, test, expect, afterAll } from 'bun:test'
import { startTestServer, type TestServer } from './helpers'
import type { Usage } from '@materin/ai'
import type { UsageSummary } from '@materin/core'

/**
 * Token usage e2e: GET /usage aggregation (period / model filters / byDay
 * buckets) and the /token slash command. Usage rows are seeded via the store,
 * one row is backdated past 7d through a direct created_at update.
 */

const srv: TestServer = startTestServer()
afterAll(() => srv.stop())

const MODEL_A = 'claude-sonnet-5-5'
const MODEL_B = 'deepseek-chat'
const DAY_MS = 86_400_000

interface Seed {
  s1: string
  s2: string
}

async function seed(): Promise<Seed> {
  const s1 = await srv.post('/session', { cwd: '/tmp' })
  const s2 = await srv.post('/session', { cwd: '/tmp' })
  const s1id = ((await s1.json()) as { id: string }).id
  const s2id = ((await s2.json()) as { id: string }).id
  let parent: string | null = null
  let backdoor: string | null = null

  const append = (sid: string, model: string, usage: Usage): string => {
    const row = srv.store.appendMessage(
      sid,
      { role: 'assistant', content: [{ type: 'text', text: 'reply' }], model: model, usage: usage },
      parent,
    )
    parent = row.id
    return row.id
  }

  append(s1id, MODEL_A, { input: 10, output: 20, cacheRead: 5 })
  append(s1id, MODEL_A, { input: 30, output: 40 })
  backdoor = append(s1id, MODEL_B, { input: 100, output: 200, cacheRead: 50 })
  append(s2id, MODEL_A, { input: 1, output: 2 })

  // backdate the model-b call 8 days so it falls out of 7d / today
  srv.db.query('UPDATE message SET created_at = ? WHERE message_uid = ?').run(Date.now() - 8 * DAY_MS, backdoor)
  srv.store.setLeaf(s1id, parent!)
  return { s1: s1id, s2: s2id }
}

let ids: Seed

describe('GET /usage aggregation', () => {
  test('period=all totals match seeded usage across sessions and models', async () => {
    ids = await seed()
    const res = await srv.get('/usage?period=all')
    expect(res.status).toBe(200)
    const body = (await res.json()) as UsageSummary
    expect(body.totals).toEqual({ input: 141, output: 262, cacheRead: 55, calls: 4 })
    expect(body.byModel.map((m) => m.model).sort()).toEqual([MODEL_A, MODEL_B])
    const modelB = body.byModel.find((m) => m.model === MODEL_B)!
    expect([modelB.input, modelB.output, modelB.cacheRead, modelB.calls]).toEqual([100, 200, 50, 1])
    expect(body.recent.length).toBe(4)
  })

  test('period=7d excludes the 8-day-old call', async () => {
    const res = await srv.get('/usage?period=7d')
    const body = (await res.json()) as UsageSummary
    expect(body.totals).toEqual({ input: 41, output: 62, cacheRead: 5, calls: 3 })
    expect(body.byModel.some((m) => m.model === MODEL_B)).toBe(false)
  })

  test('model filter narrows to that model only', async () => {
    const res = await srv.get('/usage?period=all&model=' + encodeURIComponent(MODEL_A))
    const body = (await res.json()) as UsageSummary
    expect(body.totals).toEqual({ input: 41, output: 62, cacheRead: 5, calls: 3 })
    expect(body.byModel.map((m) => m.model)).toEqual([MODEL_A])
  })

  test('byDay buckets split today vs the backdated day (ascending)', async () => {
    const res = await srv.get('/usage?period=all')
    const body = (await res.json()) as UsageSummary
    expect(body.byDay.length).toBe(2)
    expect(body.byDay[0]!.calls).toBe(1)
    expect(body.byDay[0]!.input).toBe(100)
    expect(body.byDay[1]!.calls).toBe(3)
    expect(body.byDay[0]!.day < body.byDay[1]!.day).toBe(true)
    expect(body.recent[0]!.sessionId).toBe(ids.s1)
  })
})

describe('/token command', () => {
  test('/token shows current-session per-call detail with totals', async () => {
    const res = await srv.post('/session/' + ids.s1 + '/prompt', { text: '/token' })
    const body = (await res.json()) as { command?: boolean; output?: string }
    expect(body.command).toBe(true)
    expect(body.output).toContain('input=')
    expect(body.output).toContain('total:')
    expect(body.output).toContain(MODEL_A)
  })

  test('/token all prints global totals + byModel lines', async () => {
    const res = await srv.post('/session/' + ids.s1 + '/prompt', { text: '/token all' })
    const body = (await res.json()) as { command?: boolean; output?: string }
    expect(body.command).toBe(true)
    expect(body.output).toContain('byModel:')
    expect(body.output).toContain('byDay:')
    expect(body.output).toContain(MODEL_B)
    expect(body.output).toContain('input=141')
  })

  test('/token bogus reports usage error; /help lists /token', async () => {
    const bad = await srv.post('/session/' + ids.s1 + '/prompt', { text: '/token bogus' })
    const badBody = (await bad.json()) as { output?: string }
    expect(badBody.output).toContain('usage: /token')

    const help = await srv.post('/session/' + ids.s1 + '/prompt', { text: '/help /token' })
    const helpBody = (await help.json()) as { output?: string }
    expect(helpBody.output).toContain('/token [period]')
  })
})
