import { describe, test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadExtensions } from '../src/extensions'

const EXAMPLES_DIR = join(import.meta.dir, '../../../extensions/examples')

describe('loadExtensions', () => {
  test('loads example extensions (tool, intercept, event observer)', async () => {
    const ext = await loadExtensions([EXAMPLES_DIR])
    expect(ext.tools.map((t) => t.name)).toContain('hello')
    const blocked = ext.intercept('edit', { file_path: '/proj/.env' })
    expect(blocked).not.toBeNull()
    expect(blocked!.block).toBe(true)
    expect(blocked!.reason).toBe('.env is protected')
    const allowed = ext.intercept('read', { file_path: '/proj/src/a.ts' })
    expect(allowed).toBeNull()
    // stats.ts observer does not throw when called
    ext.emit({ type: 'agent_end', sessionId: 's1', stopReason: 'stop' })
  })

  test('hello tool executes via the registered tool', async () => {
    const ext = await loadExtensions([EXAMPLES_DIR])
    const hello = ext.tools.find((t) => t.name === 'hello')!
    const result = await hello.execute({ name: 'materin' }, { cwd: tmpdir() })
    expect(result.content).toBe('Hello, materin')
  })

  test('nonexistent dir -> empty result', async () => {
    const ext = await loadExtensions([join(tmpdir(), 'materin-nope-' + Date.now())])
    expect(ext.tools).toHaveLength(0)
    expect(ext.commands.size).toBe(0)
    expect(ext.intercept('write', {})).toBeNull()
  })

  test('broken extension does not kill loading; commands map works', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-ext-'))
    writeFileSync(join(dir, 'bad.ts'), "export default () => { throw new Error('boom') }" + '\n')
    writeFileSync(
      join(dir, 'cmd.ts'),
      "import type { ExtensionAPI } from '@materin/core'" + '\n' +
        "export default (api: ExtensionAPI): void => { api.registerCommand('greet', (arg) => 'hey ' + arg) }" + '\n',
    )
    const ext = await loadExtensions([dir])
    expect(ext.commands.get('greet')).toBeTruthy()
    const handler = ext.commands.get('greet')!
    expect(await handler('world')).toBe('hey world')
    // bad.ts failed to load but cmd.ts still loaded
    expect(ext.tools).toHaveLength(0)
  })

  test('interceptor errors are swallowed and later interceptors still run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-ext-'))
    writeFileSync(
      join(dir, 'throws.ts'),
      "import type { ExtensionAPI } from '@materin/core'" + '\n' +
        "export default (api: ExtensionAPI): void => { api.interceptToolCall(() => { throw new Error('x') }) }" + '\n',
    )
    writeFileSync(
      join(dir, 'guard.ts'),
      "import type { ExtensionAPI } from '@materin/core'" + '\n' +
        "export default (api: ExtensionAPI): void => { api.interceptToolCall((tool) => tool === 'write' ? { block: true, reason: 'nope' } : undefined) }" + '\n',
    )
    const ext = await loadExtensions([dir])
    const blocked = ext.intercept('write', {})
    expect(blocked).not.toBeNull()
    expect(blocked!.reason).toBe('nope')
  })
})
