import { describe, test, expect } from 'bun:test'
import { openDb, SessionStore } from '@materin/core'
import type { ModelInfo, Provider, StreamEvent } from '@materin/ai'
import { Gateway, type GatewayDeps } from '../src/gateway'
import type { ChannelAdapter, InboundMessage } from '../src/types'

const TEST_MODEL_INFO: ModelInfo = {
  api: 'anthropic',
  apiKeyEnv: 'TEST_KEY',
  baseUrl: 'http://localhost',
  contextWindow: 1_000_000,
}

/** Test-double adapter: records everything sent back to the chat. */
class TestAdapter implements ChannelAdapter {
  readonly id = 'test'
  sent: { chatId: string; text: string }[] = []
  private handler: ((msg: InboundMessage) => Promise<void>) | null = null

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async send(chatId: string, msg: { text: string }): Promise<void> {
    this.sent.push({ chatId: chatId, text: msg.text })
  }

  async receive(text: string): Promise<void> {
    const msg: InboundMessage = { channel: 'test', chatId: 'c1', userId: 'u1', text: text, raw: null }
    await this.handler!(msg)
  }
}

/** Scripted provider: one answer per turn. */
function simpleProvider(script: string[]): Provider {
  let turn = 0
  return {
    async *stream() {
      const answer = script[turn] ?? ''
      turn += 1
      yield { type: 'text_start', index: 0 } as StreamEvent
      yield { type: 'text_delta', index: 0, delta: answer } as StreamEvent
      yield { type: 'done', usage: { input: 1, output: 1 }, stopReason: 'stop' } as StreamEvent
    },
  }
}

/** Provider whose stream N waits until release(n) >= N (queue-timing control). */
function gatedProvider(): Provider & { release: (upTo: number) => void } {
  let released = 0
  let turn = 0
  return {
    async *stream() {
      turn += 1
      const myTurn = turn
      while (released < myTurn) {
        await new Promise((r) => setTimeout(r, 5))
      }
      yield { type: 'text_start', index: 0 } as StreamEvent
      yield { type: 'text_delta', index: 0, delta: 'answer-' + String(myTurn) } as StreamEvent
      yield { type: 'done', usage: { input: 1, output: 1 }, stopReason: 'stop' } as StreamEvent
    },
    release(upTo: number) {
      released = Math.max(released, upTo)
    },
  }
}

function makeGateway(store: SessionStore, provider: Provider): TestAdapter {
  const deps: GatewayDeps = {
    store: store,
    resolveProvider: () => ({ provider: provider, api: 'anthropic' }),
    getModelInfo: () => TEST_MODEL_INFO,
    tools: [],
  }
  const gateway = new Gateway(deps)
  const adapter = new TestAdapter()
  gateway.registerAdapter(adapter)
  return adapter
}

describe('Gateway loop', () => {
  test('delivers inbound -> ack + final answer, routing row persisted', async () => {
    const store = new SessionStore(openDb(':memory:'))
    const adapter = makeGateway(store, simpleProvider(['final answer']))
    await adapter.receive('hello gateway')
    expect(adapter.sent[0]!.text).toBe('Received, working on it...')
    expect(adapter.sent[1]!.text).toBe('final answer')
    const sessionId = store.getRoutingSession('test', 'c1', 'u1')
    expect(sessionId).not.toBeNull()
    const session = store.getSession(sessionId!)
    expect(session!.source).toBe('gateway-test')
    expect(session!.cwd).toBe('/')
    expect(session!.title).toBe('test:c1')
  })

  test('second message reuses the routed session', async () => {
    const store = new SessionStore(openDb(':memory:'))
    const adapter = makeGateway(store, simpleProvider(['one', 'two']))
    await adapter.receive('first')
    const sid = store.getRoutingSession('test', 'c1', 'u1')
    await adapter.receive('second')
    expect(store.getRoutingSession('test', 'c1', 'u1')).toBe(sid)
    expect(adapter.sent.some((s) => s.text === 'two')).toBe(true)
  })

  test('message while busy is queued then processed after the current turn', async () => {
    const store = new SessionStore(openDb(':memory:'))
    const provider = gatedProvider()
    const adapter = makeGateway(store, provider)
    const p1 = adapter.receive('one')
    await new Promise((r) => setTimeout(r, 20))
    const p2 = adapter.receive('two')
    expect(adapter.sent.some((s) => s.text.includes('queued'))).toBe(true)
    provider.release(1)
    await new Promise((r) => setTimeout(r, 50))
    expect(adapter.sent.some((s) => s.text === 'answer-1')).toBe(true)
    provider.release(2)
    await p1
    await p2
    expect(adapter.sent.some((s) => s.text === 'answer-2')).toBe(true)
  })

  test('slash commands are rejected over channels', async () => {
    const store = new SessionStore(openDb(':memory:'))
    const adapter = makeGateway(store, simpleProvider(['final']))
    await adapter.receive('/compact')
    expect(adapter.sent.some((s) => s.text === 'commands are not supported over channels yet')).toBe(true)
    expect(adapter.sent.some((s) => s.text === 'final')).toBe(false)
  })
})
