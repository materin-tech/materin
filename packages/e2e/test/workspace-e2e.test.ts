import { describe, test, expect, afterAll } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configuredProviders } from '@materin/core'
import { startTestServer, type TestServer } from './helpers'

/**
 * E2E tests for the workspace surface: GET/POST /workspace, workspace-default
 * sessions, and the GET /fs/dirs folder-browser endpoint.
 */

const srv: TestServer = startTestServer()
afterAll(() => srv.stop())

describe('workspace endpoints', () => {
  test('GET /workspace returns a path initially', async () => {
    const res = await srv.get('/workspace')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { workspace: string }
    expect(body.workspace.length).toBeGreaterThan(0)
  })

  test('POST /workspace creates the dir and switches; GET reflects it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'materin-ws-'))
    const target = join(root, 'ws-a')
    const res = await srv.post('/workspace', { cwd: target })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { workspace: string }
    expect(body.workspace).toBe(target)
    expect(existsSync(target)).toBe(true)

    const got = (await (await srv.get('/workspace')).json()) as { workspace: string }
    expect(got.workspace).toBe(target)
  })

  test('POST /workspace rejects relative paths', async () => {
    const res = await srv.post('/workspace', { cwd: 'relative/path' })
    expect(res.status).toBe(400)
  })

  test('POST /session without cwd defaults to the active workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'materin-ws-'))
    const ws = join(root, 'ws-b')
    await srv.post('/workspace', { cwd: ws })
    const res = await srv.post('/session', {})
    expect(res.status).toBe(201)
    const s = (await res.json()) as { cwd: string }
    expect(s.cwd).toBe(ws)
  })

  test('GET /fs/dirs lists non-hidden, non-node_modules dirs; 400 on missing/file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'materin-fs-'))
    mkdirSync(join(root, 'alpha'))
    mkdirSync(join(root, 'zeta'))
    mkdirSync(join(root, '.hidden'))
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'file.txt'), 'x')

    const res = await srv.get('/fs/dirs?path=' + encodeURIComponent(root))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { path: string; parent: string | null; dirs: string[] }
    expect(body.path).toBe(root)
    expect(body.parent).not.toBeNull()
    expect(body.dirs).toEqual(['alpha', 'zeta'])

    const missing = await srv.get('/fs/dirs?path=' + encodeURIComponent(join(root, 'nope')))
    expect(missing.status).toBe(400)

    const fileRes = await srv.get('/fs/dirs?path=' + encodeURIComponent(join(root, 'file.txt')))
    expect(fileRes.status).toBe(400)
  })

  test('GET /fs/dirs without path uses the active workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'materin-fs-'))
    mkdirSync(join(root, 'beta'))
    await srv.post('/workspace', { cwd: root })
    const res = await srv.get('/fs/dirs')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { path: string; dirs: string[] }
    expect(body.path).toBe(root)
    expect(body.dirs).toEqual(['beta'])
  })
})

describe('unconfigured startup gate (pure function level)', () => {
  test('configuredProviders({}) is empty when no provider keys are in env', () => {
    const keys = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'DEEPSEEK_API_KEY',
      'DASHSCOPE_API_KEY',
      'MOONSHOT_API_KEY',
      'ZAI_API_KEY',
      'OPENAI_API_KEY',
    ]
    const saved = keys.map((k) => [k, process.env[k]] as const)
    for (const k of keys) delete process.env[k]
    try {
      expect(configuredProviders({})).toEqual([])
    } finally {
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v
    }
  })

  test('configuredProviders sees a config-file key', () => {
    const list = configuredProviders({ providers: { anthropic: { apiKey: 'test-key' } } })
    expect(list.map((p) => p.id)).toContain('anthropic')
  })
})
