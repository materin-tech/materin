import { describe, test, expect, afterAll } from 'bun:test'
import { collectRules } from '../src/rules'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'materin-rules-'))
const sub = join(root, 'sub')
mkdirSync(sub)
writeFileSync(join(root, 'AGENTS.md'), 'root rules')
writeFileSync(join(sub, 'AGENTS.md'), 'sub rules')
writeFileSync(join(sub, 'CLAUDE.md'), 'claude rules')

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('collectRules', () => {
  test('collects parent then nearest, nearest last', () => {
    const text = collectRules(sub)
    expect(text).toContain('root rules')
    expect(text).toContain('sub rules')
    expect(text).toContain('claude rules')
    const rootPos = text.indexOf('root rules')
    const subPos = text.indexOf('sub rules')
    expect(rootPos).toBeGreaterThanOrEqual(0)
    expect(rootPos).toBeLessThan(subPos)
    expect(text).toContain('# Rules from ' + join(root, 'AGENTS.md'))
  })

  test('nearest file appears last among duplicates', () => {
    const text = collectRules(sub)
    const lastRoot = text.lastIndexOf('# Rules from ' + join(root, 'AGENTS.md'))
    const lastSub = text.lastIndexOf('# Rules from ' + join(sub, 'AGENTS.md'))
    expect(lastSub).toBeGreaterThan(lastRoot)
  })

  test('empty cwd outside project files still resolves without throwing', () => {
    expect(() => collectRules(join(root, 'sub'))).not.toThrow()
  })
})
