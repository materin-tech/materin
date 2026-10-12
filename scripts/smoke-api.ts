/**
 * Smoke script checks: real-server API checks and TUI/gateway CLI checks.
 */

import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, record, results } from './smoke-lib'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}


export async function serverChecks(base: string): Promise<void> {
  await check('GET / -> 200', async () => {
    const res = await fetch(base + '/')
    if (!res.ok) throw new Error('status ' + res.status)
    return 'materin-server reachable'
  })

  await check('GET /openapi.json -> paths object', async () => {
    const spec = await json<{ paths: Record<string, unknown> }>(await fetch(base + '/openapi.json'))
    if (Object.keys(spec.paths).length < 5) throw new Error('paths missing')
    return String(Object.keys(spec.paths).length) + ' paths'
  })

  await check('POST /session -> 201', async () => {
    const res = await fetch(base + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    if (res.status !== 201) throw new Error('status ' + res.status)
    const s = await json<{ id: string }>(res)
    return 'session ' + s.id
  })

  const sessionId = await (async () => {
    const res = await fetch(base + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    return (await json<{ id: string }>(res)).id
  })()

  const prompt = async (text: string): Promise<Response> =>
    fetch(base + '/session/' + sessionId + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text }) })

  await check('/model sonnet -> canonical id', async () => {
    const body = await json<{ command: boolean; model: string }>(await prompt('/model sonnet'))
    if (!body.command || body.model !== 'claude-sonnet-5-5') throw new Error('model=' + body.model)
    return 'claude-sonnet-5-5'
  })

  await check('/thinking high accepted', async () => {
    const body = await json<{ command: boolean; thinkingLevel?: string }>(await prompt('/thinking high'))
    if (!body.command) throw new Error('not a command response')
    return body.thinkingLevel ?? 'ok'
  })

  await check('/mode passon accepted', async () => {
    const body = await json<{ command: boolean; output?: string }>(await prompt('/mode passon'))
    if (!body.command) throw new Error('not a command response')
    return body.output ?? 'ok'
  })

  await check('GET /models -> list', async () => {
    const models = await json<unknown[]>(await fetch(base + '/models'))
    if (!Array.isArray(models) || models.length === 0) throw new Error('empty models')
    return String(models.length) + ' models'
  })

  await check('POST prompt with @ token -> 202 + token in messages', async () => {
    const res = await prompt('hello @nope.png')
    if (res.status !== 202) throw new Error('status ' + res.status)
    const deadline = Date.now() + 5000
    for (;;) {
      const msgs = await json<Array<{ content: unknown }>>(await fetch(base + '/session/' + sessionId + '/messages'))
      if (JSON.stringify(msgs).includes('hello @nope.png')) return 'token preserved'
      if (Date.now() > deadline) throw new Error('token not found in messages within 5s')
      await new Promise((r) => setTimeout(r, 100))
    }
  })

  await check('GET /search?q=hello -> >=1 hit', async () => {
    const hits = await json<unknown[]>(await fetch(base + '/search?q=hello'))
    if (!Array.isArray(hits) || hits.length < 1) throw new Error('0 hits')
    return String(hits.length) + ' hits'
  })

  await check('GET /ui/ -> 200 HTML', async () => {
    const res = await fetch(base + '/ui/')
    if (!res.ok) throw new Error('status ' + res.status)
    if (!(res.headers.get('content-type') ?? '').startsWith('text/html')) throw new Error('not HTML')
    return 'SPA served'
  })
}

/** Run a child with a timeout; returns exit code + captured stdout. */
export async function runChild(
  cmd: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string }> {
  const proc = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  try {
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    return { code: code, stdout: stdout }
  } finally {
    clearTimeout(timer)
  }
}

export async function cliChecks(rootDir: string): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'materin-smoke-'))
  const env = { MATERIN_HOME: home, ANTHROPIC_API_KEY: 'sk-smoke-dummy' }

  const materinBin = join(rootDir, 'dist/materin')
  const useBinary = existsSync(materinBin)
  const tuiCmd = useBinary ? [materinBin] : ['bun', 'run', 'packages/tui/src/index.ts']

  await check('TUI --version prints materin', async () => {
    const r = await runChild([...tuiCmd, '--version'], env, 10_000)
    if (r.code !== 0) throw new Error('exit ' + r.code)
    if (!r.stdout.includes('materin')) throw new Error('stdout: ' + r.stdout.trim())
    return (useBinary ? 'dist binary' : 'source') + ': ' + r.stdout.trim()
  })

  await check('TUI reset --yes deletes isolated config', async () => {
    mkdirSync(home, { recursive: true })
    const cfg = join(home, 'config.json')
    writeFileSync(cfg, '{}')
    const r = await runChild([...tuiCmd, 'reset', '--yes'], env, 10_000)
    if (r.code !== 0) throw new Error('exit ' + r.code)
    if (existsSync(cfg)) throw new Error('config.json still present')
    return 'config deleted'
  })

  await check('gateway without channels exits 1 with guidance', async () => {
    const gwBin = join(rootDir, 'dist/materin-gateway')
    const gwCmd = existsSync(gwBin) ? [gwBin] : ['bun', 'run', 'packages/gateway/src/index.ts']
    const r = await runChild(gwCmd, { MATERIN_HOME: home, ANTHROPIC_API_KEY: 'sk-smoke-dummy' }, 15_000)
    if (r.code !== 1) expectNotZero(r.code)
    return 'exit 1 as expected'
  })
}

export function expectNotZero(code: number | null): void {
  if (code !== 1) throw new Error('exit ' + code)
}
