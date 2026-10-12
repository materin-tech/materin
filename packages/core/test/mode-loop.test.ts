import { describe, test, expect } from 'bun:test'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'
import { AgentSession, type AgentEvent } from '../src/agent/loop'
import { createDefaultTools } from '../src/tools'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentDeps } from '../src/agent/loop'
import type { Provider, StreamEvent, ModelInfo } from '@materin/ai'

const TEST_MODEL_INFO: ModelInfo = { api: 'anthropic', apiKeyEnv: 'TEST_KEY', baseUrl: 'http://localhost', contextWindow: 1_000_000 }

function fauxProvider(script: StreamEvent[][]): Provider {
  let i = 0
  return {
    async *stream() {
      const events = script[i] ?? []
      i++
      for (const ev of events) yield ev
    },
  } as Provider
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

const WRITE_SCRIPT: StreamEvent[][] = [
  [
    { type: 'toolcall_start', index: 0, id: 'call_1', name: 'write' },
    { type: 'toolcall_delta', index: 0, delta: JSON.stringify({ file_path: 'out.txt', content: 'written in passon' }) },
    { type: 'toolcall_end', index: 0 },
    { type: 'done', usage: { input: 10, output: 5 }, stopReason: 'toolUse' },
  ],
  [{ type: 'done', usage: { input: 10, output: 5 }, stopReason: 'stop' }],
]

function makeDeps(store: SessionStore, provider: Provider, tools: ReturnType<typeof createDefaultTools>): AgentDeps {
  return {
    store: store,
    resolveProvider: () => ({ provider: provider, api: 'anthropic' }),
    getModelInfo: () => TEST_MODEL_INFO,
    tools: tools,
    skillsDirsOverride: [],
  }
}

describe('AgentSession permission modes', () => {
  test('plan mode: write tool is blocked with read-only error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-mode-'))
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: dir, model: 'test-model' })
    store.setPermissionMode(session.id, 'plan')

    const agent = new AgentSession(session.id, {
      ...makeDeps(store, fauxProvider(WRITE_SCRIPT), createDefaultTools({ store })),
      permissions: new (await import('../src/permissions')).PermissionManager([]),
    })
    const events = await collect(agent.prompt('try to write'))
    const toolEnd = events.find((e) => e.type === 'tool_execution_end') as { isError?: boolean; preview?: string } | undefined
    expect(toolEnd).toBeTruthy()
    expect(toolEnd!.isError).toBe(true)
    expect(toolEnd!.preview).toContain('plan mode is read-only')
    expect(existsSync(join(dir, 'out.txt'))).toBe(false)
  })

  test('passon mode: write executes without permission ask', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-mode-'))
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: dir, model: 'test-model' })
    store.setPermissionMode(session.id, 'passon')

    let asked = false
    const agent = new AgentSession(session.id, {
      ...makeDeps(store, fauxProvider(WRITE_SCRIPT), createDefaultTools({ store })),
      permissions: new (await import('../src/permissions')).PermissionManager([{ tool: 'write', pattern: '*', action: 'ask' }]),
      onPermissionAsk: async () => {
        asked = true
        return false
      },
    })
    await collect(agent.prompt('write it'))
    expect(asked).toBe(false)
    expect(readFileSync(join(dir, 'out.txt'), 'utf-8')).toBe('written in passon')
  })

  test('manual mode: ask rule triggers onPermissionAsk; denial blocks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-mode-'))
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: dir, model: 'test-model' })

    let asked = false
    const agent = new AgentSession(session.id, {
      ...makeDeps(store, fauxProvider(WRITE_SCRIPT), createDefaultTools({ store })),
      permissions: new (await import('../src/permissions')).PermissionManager([{ tool: 'write', pattern: '*', action: 'ask' }]),
      onPermissionAsk: async () => {
        asked = true
        return false
      },
    })
    await collect(agent.prompt('write it'))
    expect(asked).toBe(true)
    expect(existsSync(join(dir, 'out.txt'))).toBe(false)
  })

  test('auto mode: ask rule auto-approves, write executes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-mode-'))
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: dir, model: 'test-model' })
    store.setPermissionMode(session.id, 'auto')

    let asked = false
    const agent = new AgentSession(session.id, {
      ...makeDeps(store, fauxProvider(WRITE_SCRIPT), createDefaultTools({ store })),
      permissions: new (await import('../src/permissions')).PermissionManager([{ tool: 'write', pattern: '*', action: 'ask' }]),
      onPermissionAsk: async () => {
        asked = true
        return false
      },
    })
    await collect(agent.prompt('write it'))
    expect(asked).toBe(false)
    expect(readFileSync(join(dir, 'out.txt'), 'utf-8')).toBe('written in passon')
  })
})
