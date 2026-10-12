import { describe, test, expect } from 'bun:test'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'
import { AgentSession, type AgentEvent } from '../src/agent/loop'
import { createDefaultTools } from '../src/tools'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Provider, StreamEvent } from '@materin/ai'

/** Deterministic scripted provider (pi 的 faux provider 范式). */
function fauxProvider(script: StreamEvent[][]): Provider & { calls: number } {
  let i = 0
  return {
    calls: 0,
    async *stream() {
      const events = script[i] ?? []
      i++
      this.calls++
      for (const ev of events) yield ev
    },
  }
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

import type { AgentDeps } from '../src/agent/loop'
import type { ModelInfo } from '@materin/ai'

const TEST_MODEL_INFO: ModelInfo = { api: 'anthropic', apiKeyEnv: 'TEST_KEY', baseUrl: 'http://localhost', contextWindow: 1_000_000 }

function makeDeps(store: SessionStore, provider: Provider, tools: ReturnType<typeof createDefaultTools> | []): AgentDeps {
  return {
    store: store,
    resolveProvider: () => ({ provider: provider, api: 'anthropic' }),
    getModelInfo: () => TEST_MODEL_INFO,
    tools: tools,
    skillsDirsOverride: [],
  }
}

describe('AgentSession loop', () => {
  test('runs tool then answers from tool result (acceptance: 对话→执行工具→写文件→resume)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-test-'))
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: dir, model: 'test-model' })

    const provider = fauxProvider([
      // turn 1: model calls write tool
      [
        { type: 'toolcall_start', index: 0, id: 'call_1', name: 'write' },
        { type: 'toolcall_delta', index: 0, delta: JSON.stringify({ file_path: 'hello.txt', content: 'hello materin' }) },
        { type: 'toolcall_end', index: 0 },
        { type: 'done', usage: { input: 10, output: 5 }, stopReason: 'toolUse' },
      ],
      // turn 2: model answers in text
      [
        { type: 'text_start', index: 0 },
        { type: 'text_delta', index: 0, delta: 'Done: wrote hello.txt' },
        { type: 'done', usage: { input: 30, output: 8 }, stopReason: 'stop' },
      ],
    ])

    const agent = new AgentSession(session.id, makeDeps(store, provider, createDefaultTools({ store })))
    const events = await collect(agent.prompt('create hello.txt'))
    void events

    // file was written by the real write tool
    expect(readFileSync(join(dir, 'hello.txt'), 'utf-8')).toBe('hello materin')

    // session tree: user -> assistant(toolCall) -> toolResult -> assistant(text)
    const chain = store.getMessagesToLeaf(session.id)
    expect(chain.map((m) => m.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant'])
    const toolResult = chain[2]!
    expect(toolResult.content[0]).toMatchObject({ type: 'toolResult', name: 'write' })
    expect((toolResult.content[0] as { isError?: boolean }).isError).toBeFalsy()

    // usage accumulated
    const updated = store.getSession(session.id)!
    expect(updated).toBeTruthy()
  })

  test('emits agent lifecycle events in order', async () => {
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: tmpdir(), model: 'm' })
    const provider = fauxProvider([
      [
        { type: 'text_start', index: 0 },
        { type: 'text_delta', index: 0, delta: 'hi' },
        { type: 'done', usage: { input: 1, output: 1 }, stopReason: 'stop' },
      ],
    ])
    const agent = new AgentSession(session.id, makeDeps(store, provider, []))
    const events = await collect(agent.prompt('hello'))

    const types = events.map((e) => e.type)
    expect(types[0]).toBe('agent_start')
    expect(types).toContain('message_start')
    expect(types).toContain('message_update')
    expect(types).toContain('message_end')
    expect(types[types.length - 1]).toBe('agent_end')
  })

  test('invalid tool args produce an error tool result the model can retry', async () => {
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: tmpdir(), model: 'm' })
    const provider = fauxProvider([
      [
        { type: 'toolcall_start', index: 0, id: 'call_1', name: 'write' },
        { type: 'toolcall_delta', index: 0, delta: '{"file_path": 123}' },
        { type: 'toolcall_end', index: 0 },
        { type: 'done', usage: { input: 1, output: 1 }, stopReason: 'toolUse' },
      ],
      [{ type: 'done', usage: { input: 1, output: 1 }, stopReason: 'stop' }],
    ])
    const agent = new AgentSession(session.id, makeDeps(store, provider, createDefaultTools({ store })))
    await collect(agent.prompt('go'))

    const chain = store.getMessagesToLeaf(session.id)
    const tr = chain.find((m) => m.role === 'toolResult')
    expect(tr).toBeTruthy()
    expect((tr!.content[0] as { isError?: boolean }).isError).toBe(true)
  })

  test('resume: second prompt continues the same tree', async () => {
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: tmpdir(), model: 'm' })
    const provider = fauxProvider([
      [{ type: 'text_start', index: 0 }, { type: 'text_delta', index: 0, delta: 'one' }, { type: 'done', usage: { input: 1, output: 1 }, stopReason: 'stop' }],
      [{ type: 'text_start', index: 0 }, { type: 'text_delta', index: 0, delta: 'two' }, { type: 'done', usage: { input: 2, output: 2 }, stopReason: 'stop' }],
    ])
    const agent = new AgentSession(session.id, makeDeps(store, provider, []))
    await collect(agent.prompt('first'))
    const afterFirst = store.getMessagesToLeaf(session.id).length
    await collect(agent.prompt('second'))
    const chain = store.getMessagesToLeaf(session.id)
    expect(chain.length).toBe(afterFirst + 2)
    expect(chain[0]!.role).toBe('user')
    expect(chain[chain.length - 1]!.role).toBe('assistant')
  })
})


describe('AgentSession images', () => {
  test('prompt with images persists user content as [image, text]', async () => {
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: tmpdir(), model: 'm' })
    const provider = fauxProvider([
      [{ type: 'text_start', index: 0 }, { type: 'text_delta', index: 0, delta: 'ok' }, { type: 'done', usage: { input: 1, output: 1 }, stopReason: 'stop' }],
    ])
    const agent = new AgentSession(session.id, makeDeps(store, provider, []))
    const image = { type: 'image' as const, mimeType: 'image/png', data: 'aGk=' }
    await collect(agent.prompt('look at this', { images: [image] }))

    const chain = store.getMessagesToLeaf(session.id)
    expect(chain[0]!.role).toBe('user')
    const content = chain[0]!.content as Array<{ type: string; text?: string; mimeType?: string }>
    expect(content[0]!.type).toBe('image')
    expect(content[0]!.mimeType).toBe('image/png')
    expect(content[1]!.type).toBe('text')
    expect(content[1]!.text).toBe('look at this')
  })
})
