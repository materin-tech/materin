import { describe, test, expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'
import { AgentSession, type AgentEvent, type AgentDeps } from '../src/agent/loop'
import { createTaskTool } from '../src/subagent'
import type { Provider, StreamEvent, ModelInfo } from '@materin/ai'

const TEST_MODEL_INFO: ModelInfo = { api: 'anthropic', apiKeyEnv: 'TEST_KEY', baseUrl: 'http://localhost', contextWindow: 1_000_000 }

function fauxProvider(script: StreamEvent[][]): Provider & { calls: number } {
  let i = 0
  return {
    calls: 0,
    async *stream() {
      const events = script[i] ?? []
      i += 1
      this.calls += 1
      for (const ev of events) yield ev
    },
  }
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

describe('task tool (subagent)', () => {
  test('delegates to a child session with parent lineage and returns child text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'materin-sub-'))
    const store = new SessionStore(openDb(':memory:'))
    const session = store.createSession({ cwd: dir, model: 'test-model' })

    const provider = fauxProvider([
      // parent turn 1: calls task tool
      [
        { type: 'toolcall_start', index: 0, id: 'call_1', name: 'task' },
        { type: 'toolcall_delta', index: 0, delta: JSON.stringify({ prompt: 'say hi' }) },
        { type: 'toolcall_end', index: 0 },
        { type: 'done', usage: { input: 10, output: 5 }, stopReason: 'toolUse' },
      ],
      // child turn 1 (inside task tool execution): plain text
      [
        { type: 'text_start', index: 0 },
        { type: 'text_delta', index: 0, delta: 'hi from child' },
        { type: 'done', usage: { input: 1, output: 1 }, stopReason: 'stop' },
      ],
      // parent turn 2: final answer
      [
        { type: 'text_start', index: 0 },
        { type: 'text_delta', index: 0, delta: 'done' },
        { type: 'done', usage: { input: 30, output: 8 }, stopReason: 'stop' },
      ],
    ])

    const taskTool = createTaskTool({
      store: store,
      resolveProvider: () => ({ provider: provider, api: 'anthropic' }),
      getModelInfo: () => TEST_MODEL_INFO,
      childTools: [],
      maxDepth: 1,
    })
    const deps: AgentDeps = {
      store: store,
      resolveProvider: () => ({ provider: provider, api: 'anthropic' }),
      getModelInfo: () => TEST_MODEL_INFO,
      tools: [taskTool],
      subagentDepth: 0,
      skillsDirsOverride: [],
    }
    const agent = new AgentSession(session.id, deps)
    await collect(agent.prompt('delegate'))

    // child session exists with lineage
    const childRow = store.listSessions().find((s) => s.source === 'subagent')
    expect(childRow).toBeTruthy()
    expect(childRow!.parentSessionId).toBe(session.id)

    // toolResult content contains child's answer
    const chain = store.getMessagesToLeaf(session.id)
    const tr = chain.find((m) => m.role === 'toolResult')
    expect(tr).toBeTruthy()
    const block = tr!.content[0] as { name: string; content: Array<{ text: string }> }
    expect(block.name).toBe('task')
    expect(block.content[0]!.text).toContain('hi from child')
  })

  test('depth limit: subagentDepth >= maxDepth errors without creating a session', async () => {
    const store = new SessionStore(openDb(':memory:'))
    const taskTool = createTaskTool({
      store: store,
      resolveProvider: () => ({ provider: undefined as never, api: 'anthropic' }),
      getModelInfo: () => TEST_MODEL_INFO,
      childTools: [],
      maxDepth: 1,
    })
    const before = store.listSessions().length
    const result = await taskTool.execute({ prompt: 'x' }, { cwd: tmpdir(), subagentDepth: 1 })
    expect(result.isError).toBe(true)
    expect(result.content).toBe('subagent depth limit reached')
    expect(store.listSessions().length).toBe(before)
  })
})
