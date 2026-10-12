import { describe, test, expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'
import { MemoryStore } from '../src/memory'
import { reflectAfterTurn, REFLECTION_PROMPT } from '../src/reflection'
import type { Provider, StreamEvent } from '@materin/ai'

function fauxProvider(script: StreamEvent[][]): Provider & { calls: number } {
  let i = 0
  return {
    calls: 0,
    async *stream() {
      const events = script[i] ?? []
      i += 1
      this.calls += 1
      for (const ev of events) yield ev
    },
  }
}

function textTurn(text: string): StreamEvent[] {
  return [
    { type: 'text_start', index: 0 },
    { type: 'text_delta', index: 0, delta: text },
    { type: 'done', usage: { input: 1, output: 1 }, stopReason: 'stop' },
  ]
}

describe('reflectAfterTurn', () => {
  test('applies memory operations from provider output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-refl-'))
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: dir, model: 'm' })
    const u1 = store.appendMessage(session.id, { role: 'user', content: [{ type: 'text', text: 'I prefer Chinese responses' }] }, null)
    const a1 = store.appendMessage(session.id, { role: 'assistant', content: [{ type: 'text', text: '好的' }] }, u1.id)
    store.setLeaf(session.id, a1.id)

    const provider = fauxProvider([textTurn('[{"action":"add","text":"User prefers Chinese responses"}]')])
    const memory = new MemoryStore(dir)
    const result = await reflectAfterTurn({
      store: store,
      memory: memory,
      resolveProvider: () => ({ provider: provider, api: 'anthropic' }),
      model: 'm',
      sessionId: session.id,
    })
    expect(result.applied).toBe(true)
    expect(memory.readSnapshot()).toContain('User prefers Chinese responses')
  })

  test('fenced JSON is stripped before parsing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-refl-'))
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: dir, model: 'm' })
    const u1 = store.appendMessage(session.id, { role: 'user', content: [{ type: 'text', text: 'hi' }] }, null)
    store.setLeaf(session.id, u1.id)
    const provider = fauxProvider([textTurn('```json\n[{"action":"add","text":"Fact A"}]\n```')])
    const memory = new MemoryStore(dir)
    const result = await reflectAfterTurn({
      store: store,
      memory: memory,
      resolveProvider: () => ({ provider: provider, api: 'anthropic' }),
      model: 'm',
      sessionId: session.id,
    })
    expect(result.applied).toBe(true)
    expect(memory.readSnapshot()).toContain('Fact A')
  })

  test('malformed JSON -> applied false, never throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-refl-'))
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: dir, model: 'm' })
    const u1 = store.appendMessage(session.id, { role: 'user', content: [{ type: 'text', text: 'hi' }] }, null)
    store.setLeaf(session.id, u1.id)
    const provider = fauxProvider([textTurn('not json at all')])
    const memory = new MemoryStore(dir)
    const result = await reflectAfterTurn({
      store: store,
      memory: memory,
      resolveProvider: () => ({ provider: provider, api: 'anthropic' }),
      model: 'm',
      sessionId: session.id,
    })
    expect(result.applied).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  test('provider error event -> applied false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-refl-'))
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: dir, model: 'm' })
    const u1 = store.appendMessage(session.id, { role: 'user', content: [{ type: 'text', text: 'hi' }] }, null)
    store.setLeaf(session.id, u1.id)
    const provider = fauxProvider([[{ type: 'error', error: new Error('boom') }]])
    const memory = new MemoryStore(dir)
    const result = await reflectAfterTurn({
      store: store,
      memory: memory,
      resolveProvider: () => ({ provider: provider, api: 'anthropic' }),
      model: 'm',
      sessionId: session.id,
    })
    expect(result.applied).toBe(false)
  })

  test('empty session -> applied false without provider call', async () => {
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: tmpdir(), model: 'm' })
    const provider = fauxProvider([])
    const result = await reflectAfterTurn({
      store: store,
      memory: new MemoryStore(mkdtempSync(join(tmpdir(), 'materin-refl-'))),
      resolveProvider: () => ({ provider: provider, api: 'anthropic' }),
      model: 'm',
      sessionId: session.id,
    })
    expect(result.applied).toBe(false)
    expect(provider.calls).toBe(0)
  })
})
