import { describe, test, expect } from 'bun:test'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'
import { AgentSession, type AgentDeps } from '../src/agent/loop'
import type { Provider, StreamContext, StreamEvent, ModelInfo } from '@materin/ai'

const TEST_MODEL_INFO: ModelInfo = {
  api: 'anthropic',
  apiKeyEnv: 'TEST_KEY',
  baseUrl: 'http://localhost',
  contextWindow: 1_000_000,
}

/** faux provider that captures the StreamContext each turn (pass-through probe). */
function capturingProvider(captured: StreamContext[]): Provider {
  return {
    async *stream(ctx: StreamContext): AsyncIterable<StreamEvent> {
      captured.push(ctx)
      yield { type: 'text_start', index: 0 }
      yield { type: 'text_delta', index: 0, delta: 'ok' }
      yield { type: 'done', usage: { input: 1, output: 1 }, stopReason: 'stop' }
    },
  }
}

function makeDeps(store: SessionStore, provider: Provider): AgentDeps {
  return {
    store: store,
    resolveProvider: () => ({ provider: provider, api: 'anthropic' }),
    getModelInfo: () => TEST_MODEL_INFO,
    tools: [],
    skillsDirsOverride: [],
  }
}

describe('loop passes thinkingLevel through to the provider', () => {
  test('session thinking high -> StreamContext.thinkingLevel high; default off', async () => {
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: '/tmp/x', model: 'm' })
    expect(store.getSession(session.id)!.thinkingLevel).toBe('off')

    const captured: StreamContext[] = []
    const agent = new AgentSession(session.id, makeDeps(store, capturingProvider(captured)))
    for await (const _ of agent.prompt('hello')) void _

    const defaultCtx = captured[0]!
    expect(defaultCtx.thinkingLevel).toBe('off')

    store.setThinkingLevel(session.id, 'HIGH') // case-insensitive at the boundary
    for await (const _ of agent.prompt('again')) void _

    expect(captured).toHaveLength(2)
    expect(captured[1]!.thinkingLevel).toBe('high')
  })
})
