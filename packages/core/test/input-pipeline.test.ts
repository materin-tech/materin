import { describe, test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseInput } from '../src/input-pipeline'

const dir = mkdtempSync(join(tmpdir(), 'materin-input-'))

describe('parseInput', () => {
  test('parses /commands with optional arg', async () => {
    const r = await parseInput('/model deepseek-chat', dir)
    expect(r.command).toEqual({ name: '/model', arg: 'deepseek-chat' })
    expect(r.text).toBe('')

    const r2 = await parseInput('/new', dir)
    expect(r2.command).toEqual({ name: '/new', arg: undefined })
  })

  test('@missing file token stays in text', async () => {
    const r = await parseInput('look at @missing.png please', dir)
    expect(r.text).toBe('look at @missing.png please')
    expect(r.images).toHaveLength(0)
    expect(r.attachments).toHaveLength(0)
  })

  test('@existing text file attaches content and token removed', async () => {
    writeFileSync(join(dir, 'real.txt'), 'hello attachment')
    const r = await parseInput('check @real.txt now', dir)
    expect(r.text).toBe('check  now')
    expect(r.attachments).toHaveLength(1)
    expect(r.attachments[0]).toContain('[Attached: ' + join(dir, 'real.txt') + ']')
    expect(r.attachments[0]).toContain('hello attachment')
  })

  test('image file attach: base64 + mimeType, token removed', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 1, 0, 0, 0, 0, 0])
    writeFileSync(join(dir, 'tiny.png'), png)
    const r = await parseInput('what is @tiny.png', dir)
    expect(r.images).toHaveLength(1)
    expect(r.images[0]).toMatchObject({ type: 'image', mimeType: 'image/png', data: png.toString('base64') })
    expect(r.text).toBe('what is')
  })

  test('! runs shell and attaches output', async () => {
    const r = await parseInput('!echo hello-from-shell', dir)
    expect(r.text).toBe('(shell output attached)')
    expect(r.attachments).toHaveLength(1)
    expect(r.attachments[0]).toContain('[Shell output: echo hello-from-shell]')
    expect(r.attachments[0]).toContain('hello-from-shell')
  })
})
