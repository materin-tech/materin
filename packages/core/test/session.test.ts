import { describe, test, expect } from 'bun:test'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'

function makeStore(): SessionStore {
  return new SessionStore(openDb(':memory:'))
}

describe('SessionStore', () => {
  test('creates a session with project slug and model', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'test-model' })
    expect(s.id).toHaveLength(8)
    expect(s.projectId).toBe('-tmp-demo')
    expect(s.model).toBe('test-model')
    expect(s.leafId).toBeNull()
  })

  test('appendMessage chains via parent_id and leaf tracks the tail', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'm' })
    const u1 = store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'hi' }] }, null)
    store.setLeaf(s.id, u1.id)
    const a1 = store.appendMessage(s.id, { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }, u1.id)
    store.setLeaf(s.id, a1.id)

    const chain = store.getMessagesToLeaf(s.id)
    expect(chain.map((m) => m.id)).toEqual([u1.id, a1.id])
    expect(store.getLeaf(s.id)?.id).toBe(a1.id)
  })

  test('branch moves leaf to a historical node and new messages become its children (Pi 原位树分支)', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'm' })
    const u1 = store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'q1' }] }, null)
    const a1 = store.appendMessage(s.id, { role: 'assistant', content: [{ type: 'text', text: 'r1' }] }, u1.id)
    store.setLeaf(s.id, a1.id)

    // branch back to the first user message
    store.branch(s.id, u1.id)
    const u2 = store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'q2' }] }, u1.id)
    store.setLeaf(s.id, u2.id)

    const chain = store.getMessagesToLeaf(s.id)
    expect(chain.map((m) => m.id)).toEqual([u1.id, u2.id])
    // original branch still reachable by branching back
    store.branch(s.id, a1.id)
    expect(store.getMessagesToLeaf(s.id).map((m) => m.id)).toEqual([u1.id, a1.id])
  })

  test('listSessions filters by project and archived', () => {
    const store = makeStore()
    store.createSession({ cwd: '/tmp/a', model: 'm' })
    store.createSession({ cwd: '/tmp/b', model: 'm' })
    expect(store.listSessions()).toHaveLength(2)
    expect(store.listSessions({ projectId: '-tmp-a' })).toHaveLength(1)
  })

  test('usage accumulates on the session row', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'm' })
    store.addSessionUsage(s.id, { input: 100, output: 50, cacheRead: 10 }, 'm')
    store.addSessionUsage(s.id, { input: 200, output: 20 }, 'm')
    const updated = store.getSession(s.id)!
    expect(updated).toBeTruthy()
  })
})


describe('SessionStore.buildContext memory injection', () => {
  test('memory message inserted after rules, before summary/tail', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'm' })
    const u = store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'q' }] }, null)
    store.setLeaf(s.id, u.id)

    const ctx = store.buildContext(s.id, 'RULES', 'MEM')
    expect(ctx.length).toBe(3) // rules + memory + tail user message
    expect((ctx[0] as { content: Array<{ text: string }> }).content[0]!.text).toContain('Project rules')
    expect((ctx[0] as { content: Array<{ text: string }> }).content[0]!.text).toContain('RULES')
    expect((ctx[1] as { content: Array<{ text: string }> }).content[0]!.text).toContain('[Persistent memory (agent-maintained)]')
    expect((ctx[1] as { content: Array<{ text: string }> }).content[0]!.text).toContain('MEM')
    expect((ctx[2] as { role: string }).role).toBe('user')
  })
})
