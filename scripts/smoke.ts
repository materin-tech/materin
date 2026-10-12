#!/usr/bin/env bun
/**
 * Fast end-to-end smoke (target ~15s): real artifacts, no unit mocks.
 * Steps: web build (if missing) -> real server -> API checks -> TUI/gateway CLI checks.
 * Run: bun run smoke
 */

import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, freePort, record, results, spawnServer, waitUp } from './smoke-lib'
import { serverChecks, cliChecks } from './smoke-api'


async function main(): Promise<void> {
  const rootDir = join(import.meta.dir, '..')
  console.log('materin smoke — ' + new Date().toISOString())

  // Step 1: web build (only if dist missing; build is slow, skip when present)
  await check('web dist present (build if missing)', async () => {
    const dist = join(rootDir, 'packages/web/dist/index.html')
    if (existsSync(dist)) return 'already built'
    const proc = Bun.spawn(['bun', 'run', 'web:build'], { cwd: rootDir, stdout: 'ignore', stderr: 'pipe' })
    const code = await proc.exited
    if (code !== 0 || !existsSync(dist)) throw new Error('web:build failed (exit ' + code + ')')
    return 'built during smoke'
  })

  // Step 2: start the real server on a random port with an isolated MATERIN_HOME
  const home = mkdtempSync(join(tmpdir(), 'materin-smoke-server-'))
  const port = freePort()
  const server = spawnServer(home, port)
  const base = 'http://127.0.0.1:' + port
  let serverChecksOk = false
  try {
    await waitUp(base, 5000)
    console.log('  [info] server: ' + (existsSync(join(rootDir, 'dist/materin-server')) ? 'dist/materin-server' : 'source') + ' on ' + base)
    await serverChecks(base)
    serverChecksOk = true
  } catch (e) {
    server.kill()
    const stderr = await new Response(server.stderr).text()
    record('server start', false, (e instanceof Error ? e.message : String(e)) + (stderr.trim() ? ' | stderr: ' + stderr.trim().slice(0, 300) : ''))
  } finally {
    server.kill()
  }

  // Step 4: TUI + gateway CLI checks
  await cliChecks(rootDir)

  const passed = results.filter((r) => r.ok).length
  const total = results.length
  for (const r of results) {
    if (!r.ok) console.log('  detail [' + r.name + ']: ' + r.note)
  }
  console.log('SMOKE: ' + (passed === total && total > 0 && serverChecksOk ? 'PASS' : 'FAIL') + ' (' + passed + '/' + total + ')')
  process.exit(passed === total && total > 0 ? 0 : 1)
}

void main()
