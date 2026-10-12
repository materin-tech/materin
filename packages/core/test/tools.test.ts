import { describe, test, expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'
import { createDefaultTools } from '../src/tools'
import { MemoryStore } from '../src/memory'

function makeTools(memory?: MemoryStore) {
  const store = new SessionStore(openDb(':memory:'))
  return { store: store, tools: createDefaultTools({ store: store, memory: memory }) }
}

describe('session_search tool', () => {
  test('finds a message appended via the store', async () => {
    const { store, tools } = makeTools()
    const s = store.createSession({ cwd: '/tmp/demo', model: 'm' })
    const u = store.appendMessage(s.id, { role: 'user', content: [{ type: 'text', text: 'the compression uses zstd' }] }, null)
    store.setLeaf(s.id, u.id)

    const tool = tools.find((t) => t.name === 'session_search')
    if (!tool) throw new Error('session_search tool missing')
    const out = await tool.execute({ query: 'zstd' }, { cwd: '/tmp' })
    expect(out.isError).toBeFalsy()
    expect(out.content).toContain('[' + s.id + ']')
    expect(out.content).toContain('zstd')
  })

  test('no results message', async () => {
    const { tools } = makeTools()
    const tool = tools.find((t) => t.name === 'session_search')
    if (!tool) throw new Error('session_search tool missing')
    const out = await tool.execute({ query: 'zzznothing' }, { cwd: '/tmp' })
    expect(out.content).toBe('No results.')
  })
})

describe('memory tool', () => {
  test('persists via MemoryStore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-memtool-'))
    const memory = new MemoryStore(dir)
    const { tools } = makeTools(memory)
    const tool = tools.find((t) => t.name === 'memory')
    if (!tool) throw new Error('memory tool missing')
    const out = await tool.execute({ operations: [{ action: 'add', text: 'user likes tea' }] }, { cwd: '/tmp' })
    expect(out.content).toBe('Memory updated.')
    expect(memory.readSnapshot()).toContain('user likes tea')
  })

  test('returns isError when memory not configured', async () => {
    const { tools } = makeTools()
    const tool = tools.find((t) => t.name === 'memory')
    if (!tool) throw new Error('memory tool missing')
    const out = await tool.execute({ operations: [{ action: 'add', text: 'x' }] }, { cwd: '/tmp' })
    expect(out.isError).toBe(true)
    expect(out.content).toBe('memory not configured')
  })
})
