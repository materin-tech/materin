import { describe, test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, MEMORY_LIMIT } from '../src/memory'

function makeStore(): { store: MemoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'materin-mem-'))
  return { store: new MemoryStore(dir), dir }
}

describe('MemoryStore', () => {
  test('add / replace / remove happy path', async () => {
    const { store, dir } = makeStore()
    expect(await store.apply([{ action: 'add', text: 'User prefers Bun runtime' }])).toEqual({ ok: true })
    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf-8')).toBe('User prefers Bun runtime')
    expect(await store.apply([{ action: 'add', text: 'Project uses bun:sqlite' }])).toEqual({ ok: true })
    expect(store.readSnapshot()).toBe('User prefers Bun runtime\nProject uses bun:sqlite')

    await store.apply([{ action: 'replace', find: 'prefers Bun runtime', text: 'prefers Deno' }])
    expect(store.readSnapshot()).toContain('prefers Deno')

    await store.apply([{ action: 'remove', find: 'Project uses bun:sqlite' }])
    expect(store.readSnapshot()).not.toContain('bun:sqlite')
  })

  test('over-limit returns error and file unchanged', async () => {
    const { store, dir } = makeStore()
    writeFileSync(join(dir, 'MEMORY.md'), 'x'.repeat(MEMORY_LIMIT))
    const result = await store.apply([{ action: 'add', text: 'more' }])
    expect(result.ok).toBe(false)
    if (!result.ok && typeof result.overBy === 'number') {
      expect(result.overBy).toBe(5)
    } else {
      throw new Error('expected overBy')
    }
    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf-8').length).toBe(MEMORY_LIMIT)
  })

  test('find-not-unique and not-found return errors', async () => {
    const { store } = makeStore()
    await store.apply([{ action: 'add', text: 'dup entry' }])
    await store.apply([{ action: 'add', text: 'another dup entry' }])
    const r1 = await store.apply([{ action: 'replace', find: 'dup entry', text: 'x' }])
    expect(r1.ok).toBe(false)
    if (!r1.ok && r1.error) expect(r1.error).toContain('2 times')
    const r2 = await store.apply([{ action: 'remove', find: 'does-not-exist' }])
    expect(r2.ok).toBe(false)
  })

  test('snapshot roundtrip: empty -> "" then add -> content', async () => {
    const { store } = makeStore()
    expect(store.readSnapshot()).toBe('')
    await store.apply([{ action: 'add', text: 'fact one' }])
    expect(store.readSnapshot()).toBe('fact one')
  })
})
