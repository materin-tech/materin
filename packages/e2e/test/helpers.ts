import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from 'bun:sqlite'
import { createApp } from '@materin/server'
import {
  openDb,
  SessionStore,
  Bus,
  AgentSession,
  createDefaultTools,
  MemoryStore,
  PermissionManager,
  parsePermissionRules,
  type AgentEvent,
} from '@materin/core'
import { getModel } from '@materin/ai'
import type { Provider, StreamContext, StreamEvent } from '@materin/ai'

/**
 * Shared e2e harness: in-process Hono app behind Bun.serve (real HTTP + SSE),
 * with a scripted faux provider (no network, pi fauxProvider pattern).
 */

export interface FauxProvider extends Provider {
  /** Scripted StreamEvent batches; one batch is consumed per LLM call. */
  script: StreamEvent[][]
  /** StreamContext captured at each LLM call (thinkingLevel pass-through probe). */
  contexts: StreamContext[]
  calls: number
}

export function fauxProvider(): FauxProvider {
  const faux: FauxProvider = {
    script: [],
    contexts: [],
    calls: 0,
    async *stream(ctx: StreamContext): AsyncIterable<StreamEvent> {
      faux.contexts.push(ctx)
      faux.calls += 1
      const events = faux.script.shift() ?? []
      for (const ev of events) yield ev
    },
  }
  return faux
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface TestServer {
  base: string
  store: SessionStore
  db: Database
  faux: FauxProvider
  setProvider(p: Provider): void
  get(path: string): Promise<Response>
  post(path: string, body?: unknown): Promise<Response>
  del(path: string): Promise<Response>
  stop(): void
}

export function startTestServer(): TestServer {
  const db = openDb(':memory:')
  const store = new SessionStore(db)
  const bus = new Bus<AgentEvent>()
  const faux = fauxProvider()
  let current: Provider = faux

  const app = createApp({
    store: store,
    bus: bus,
    createAgent: (sessionId) =>
      new AgentSession(sessionId, {
        store: store,
        resolveProvider: () => ({ provider: current, api: 'anthropic' }),
        getModelInfo: (m) => getModel(m),
        tools: createDefaultTools({ store: store }),
        permissions: new PermissionManager(parsePermissionRules('')),
        skillsDirsOverride: [],
      }),
    resolveProvider: () => ({ provider: current, api: 'anthropic' as const }),
    answerPermission: () => false,
    getMemory: () => new MemoryStore(mkdtempSync(join(tmpdir(), 'materin-mem-'))),
    getDb: () => db,
  })

  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch, idleTimeout: 255 })
  const base = 'http://127.0.0.1:' + server.port

  return {
    base: base,
    store: store,
    db: db,
    faux: faux,
    setProvider(p: Provider): void {
      current = p
    },
    async get(path: string): Promise<Response> {
      return fetch(base + path)
    },
    async post(path: string, body?: unknown): Promise<Response> {
      return fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    },
    async del(path: string): Promise<Response> {
      return fetch(base + path, { method: 'DELETE' })
    },
    stop(): void {
      server.stop(true)
    },
  }
}

export function tmpCwd(): string {
  return mkdtempSync(join(tmpdir(), 'materin-e2e-'))
}

export interface RunMsg {
  role: string
  content: unknown
  stopReason?: string
}

/** Poll messages until the chain grows past minCount and ends with an
 *  assistant that has no pending tool call. */
export async function awaitRunDone(
  srv: TestServer,
  sessionId: string,
  minCount = 0,
  timeoutMs = 5000,
): Promise<RunMsg[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const res = await srv.get('/session/' + sessionId + '/messages')
    if (res.ok) {
      const msgs = (await res.json()) as RunMsg[]
      const last = msgs[msgs.length - 1]
      const pendingToolCall =
        last?.role === 'assistant' &&
        Array.isArray(last.content) &&
        (last.content as Array<{ type: string }>).some((b) => b?.type === 'toolCall')
      if (msgs.length >= minCount && last?.role === 'assistant' && !pendingToolCall) return msgs
    }
    if (Date.now() > deadline) throw new Error('awaitRunDone timeout after ' + timeoutMs + 'ms')
    await sleep(25)
  }
}
