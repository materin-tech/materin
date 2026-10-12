/**
 * Smoke script shared utilities (record/check/freePort/waitUp/spawn/runChild).
 * Entry point: scripts/smoke.ts — run via `bun run smoke`.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const results: Array<{ name: string; ok: boolean; note: string }> = []

export function record(name: string, ok: boolean, note = ''): void {
  results.push({ name: name, ok: ok, note: note })
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (note ? ' — ' + note : ''))
}

export async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    record(name, true, await fn())
  } catch (e) {
    record(name, false, e instanceof Error ? e.message : String(e))
  }
}

/** Probe a concrete bindable port (Bun.serve({port:0}).port reads 0 after stop in some versions). */
export function freePort(): number {
  for (let i = 0; i < 20; i++) {
    const candidate = 20000 + Math.floor(Math.random() * 20000)
    try {
      const s = Bun.serve({ port: candidate, hostname: '127.0.0.1', fetch: () => new Response('x') })
      s.stop(true)
      return candidate
    } catch {
      // busy, try another
    }
  }
  return 4128
}

export async function waitUp(base: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      if ((await fetch(base + '/')).ok) return
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('server not up within ' + timeoutMs + 'ms')
    await new Promise((r) => setTimeout(r, 100))
  }
}

export function spawnServer(home: string, port: number): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  const bin = join(import.meta.dir, '../dist/materin-server')
  const useBinary = existsSync(bin)
  const cmd = useBinary ? [bin] : ['bun', 'run', 'packages/server/src/index.ts']
  return Bun.spawn(cmd, {
    env: {
      ...process.env,
      MATERIN_HOME: home,
      MATERIN_PORT: String(port),
      ANTHROPIC_API_KEY: 'sk-smoke-dummy',
      // compiled binary resolves import.meta.dir next to the executable -> point at the repo web dist
      MATERIN_WEB_ROOT: join(import.meta.dir, '../packages/web/dist'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

