import { describe, test, expect, afterAll } from 'bun:test'
import { listFiles, atToken } from '../src/fs-list'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(tmpdir(), 'materin-fslist-test')
mkdirSync(join(root, 'src/deep'), { recursive: true })
mkdirSync(join(root, 'node_modules/pkg'), { recursive: true })
mkdirSync(join(root, '.git'), { recursive: true })
writeFileSync(join(root, 'loader.ts'), 'x')
writeFileSync(join(root, 'src/local.ts'), 'x')
writeFileSync(join(root, 'src/deep/nested-load.ts'), 'x')
writeFileSync(join(root, 'node_modules/pkg/index.js'), 'x')
writeFileSync(join(root, '.git/config'), 'x')

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listFiles / atToken', () => {
  test('atToken: active token after @, junk after whitespace, whole q without @', () => {
    expect(atToken('use @src/lo')).toBe('src/lo')
    expect(atToken('@src then')).toBe('')
    expect(atToken('lo')).toBe('lo')
    expect(atToken('no at here')).toBe('no at here')
  })

  test('lists relative paths recursively, skipping node_modules/.git', () => {
    const files = listFiles(root, '')
    expect(files).toContain('loader.ts')
    expect(files).toContain(join('src', 'local.ts'))
    expect(files).toContain(join('src', 'deep', 'nested-load.ts'))
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
    expect(files.some((f) => f.startsWith('.git'))).toBe(false)
  })

  test('filters by q token substring (case-insensitive)', () => {
    const files = listFiles(root, '@LOCAL')
    expect(files).toEqual([join('src', 'local.ts')])
    expect(files).not.toContain('loader.ts')
  })
})
