import { describe, test, expect } from 'bun:test'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'
import { searchMessages } from '../src/session/search'

function makeStore(): SessionStore {
  return new SessionStore(openDb(':memory:'))
}

describe('FTS5 message search', () => {
  test('indexes user+assistant messages and finds Chinese substring (trigram)', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'm' })
    const u = store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: '我们采用新的压缩算法来减少内存占用' }] }, null)
    store.setLeaf(s.id, u.id)
    const a = store.appendMessage(s.id, { role: 'assistant', content: [{ type: 'text', text: '好的，我会记住这个决定' }] }, u.id)
    store.setLeaf(s.id, a.id)

    const hits = store.search('压缩算')
    expect(hits.length).toBe(1)
    expect(hits[0]!.messageId).toBe(u.id)
    expect(hits[0]!.sessionId).toBe(s.id)
    expect(hits[0]!.snippet).toContain('压缩算')
    expect(typeof hits[0]!.rank).toBe('number')
  })

  test('double quotes in query are escaped as a phrase', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'm' })
    const u = store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'say "quoted phrase" out loud' }] }, null)
    store.setLeaf(s.id, u.id)

    const hits = store.search('quoted phrase')
    expect(hits.length).toBe(1)
    expect(hits[0]!.snippet).toContain('quoted phrase')
  })

  test('store.search finds by English word', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'm' })
    const u = store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'the database engine uses WAL mode' }] }, null)
    store.setLeaf(s.id, u.id)

    const hits = store.search('database')
    expect(hits.length).toBe(1)
    expect(hits[0]!.snippet).toContain('database')
  })

  test('unrelated query returns 0 rows', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'm' })
    const u = store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'the database engine uses WAL mode' }] }, null)
    store.setLeaf(s.id, u.id)

    expect(store.search('quantumfrobnicator').length).toBe(0)
    expect(store.search('').length).toBe(0)
  })

  test('1-2 char CJK query falls back to scan and finds message', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'm' })
    const u = store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: '长期记忆需要持久化' }] }, null)
    store.setLeaf(s.id, u.id)

    const hits = store.search('记忆')
    expect(hits.length).toBe(1)
    expect(hits[0]!.messageId).toBe(u.id)
    expect(hits[0]!.snippet).toContain('记忆')
    expect(store.search('记').length).toBe(1)
  })

  test('toolResult messages are not indexed', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'm' })
    const u = store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'run the build' }] }, null)
    const a = store.appendMessage(s.id, { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }] }, u.id)
    store.appendMessage(s.id, { role: 'toolResult', content: [{ type: 'toolResult', id: 'c1', name: 'bash', content: [{ type: 'text', text: 'SUPERSECRETOUTPUT' }] }] }, a.id)
    store.setLeaf(s.id, a.id)

    expect(store.search('SUPERSECRETOUTPUT').length).toBe(0)
    expect(store.search('run the build').length).toBe(1)
  })
})
