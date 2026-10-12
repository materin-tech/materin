import { describe, test, expect } from 'bun:test'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'
import { compact, selectTail } from '../src/agent/compaction'
import type { ResolveProvider } from '../src/agent/compaction'
import type { Provider } from '@materin/ai'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function summaryProvider(text: string): Provider {
  return {
    async *stream() {
      yield { type: 'text_start' as const, index: 0 }
      yield { type: 'text_delta' as const, index: 0, delta: text }
      yield { type: 'done' as const, usage: { input: 1, output: 1 }, stopReason: 'stop' as const }
    },
  }
}

function resolver(text: string): ResolveProvider {
  return () => ({ provider: summaryProvider(text), api: 'anthropic' })
}

function makeStore(): SessionStore {
  return new SessionStore(openDb(':memory:'))
}

function appendChain(store: SessionStore, sessionId: string, pairs: number): void {
  let parent: string | null = null
  for (let i = 0; i < pairs; i += 1) {
    const u = store.appendMessage(sessionId, { role: 'user', content: [{ type: 'text', text: 'q' + i }] }, parent)
    const a = store.appendMessage(
      sessionId,
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'a' + i }],
        usage: { input: 100 + i, output: 10 },
        stopReason: 'stop',
      },
      u.id,
    )
    store.setLeaf(sessionId, a.id)
    parent = a.id
  }
}

function cwd(): string {
  return tmpdir()
}

describe('compact', () => {
  test('summarizes head, keeps tail, leaf unchanged', async () => {
    const store = makeStore()
    const s = store.createSession({ cwd: cwd(), model: 'm' })
    appendChain(store, s.id, 13) // 26 messages: head = 6, tail = 20
    const leafBefore = store.getLeaf(s.id)!.id
    const chainBefore = store.getMessagesToLeaf(s.id).length

    const result = await compact(store, resolver('SUMMARY-TEXT'), 'm', s.id)
    expect(result).not.toBeNull()
    expect(result!.summary).toBe('SUMMARY-TEXT')
    expect(result!.tokensBefore).toBe(112)

    expect(store.listCompactions(s.id)).toHaveLength(1)
    const anchorId = store.compactionAnchor(s.id)
    expect(anchorId).not.toBeNull()
    expect(anchorId).toBe(store.listCompactions(s.id)[0]!.anchorMessageId)

    // append-only: leaf and full chain unchanged
    expect(store.getLeaf(s.id)!.id).toBe(leafBefore)
    expect(store.getMessagesToLeaf(s.id).length).toBe(chainBefore)

    // context = [summary] + tail
    const context = store.buildContext(s.id)
    expect(context[0]!.role).toBe('user')
    const firstText = (context[0]!.content as Array<{ text: string }>)[0]!.text
    expect(firstText.startsWith('[Earlier conversation summary]')).toBe(true)
    expect(firstText).toContain('SUMMARY-TEXT')
    const chain = store.getMessagesToLeaf(s.id)
    const anchorIdx = chain.findIndex((m) => m.id === anchorId)
    expect(context.length).toBe(1 + (chain.length - anchorIdx))
    expect(context[1]!.role).toBe('user')
  })

  test('returns null when the chain is short and starts with a user message', async () => {
    const store = makeStore()
    const s = store.createSession({ cwd: cwd(), model: 'm' })
    appendChain(store, s.id, 4)
    const result = await compact(store, resolver('x'), 'm', s.id)
    expect(result).toBeNull()
  })
})

describe('buildContext', () => {
  test('rules message comes first, then summary, then tail', async () => {
    const store = makeStore()
    const s = store.createSession({ cwd: cwd(), model: 'm' })
    appendChain(store, s.id, 13)
    await compact(store, resolver('SUM'), 'm', s.id)
    const context = store.buildContext(s.id, 'RULES-TEXT')
    expect(context.length).toBe(2 + 20) // rules + summary + 20-message tail
    const rulesText = (context[0]!.content as Array<{ text: string }>)[0]!.text
    const summaryText = (context[1]!.content as Array<{ text: string }>)[0]!.text
    expect(rulesText).toContain('RULES-TEXT')
    expect(summaryText).toContain('SUM')
    expect(context[2]!.role).toBe('user')
  })
})

describe('selectTail', () => {
  test('extends back to a user message (tool-pair safety)', () => {
    const store = makeStore()
    const s = store.createSession({ cwd: cwd(), model: 'm' })
    appendChain(store, s.id, 13)
    const leaf = store.getLeaf(s.id)!.id
    const a = store.appendMessage(
      s.id,
      { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'read', arguments: {} }] },
      leaf,
    )
    store.setLeaf(s.id, a.id)
    const tr = store.appendMessage(
      s.id,
      {
        role: 'toolResult',
        content: [
          { type: 'toolResult', id: 'c1', name: 'read', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
      a.id,
    )
    store.setLeaf(s.id, tr.id)

    const chain = store.getMessagesToLeaf(s.id)
    const tail = selectTail(chain)
    expect(tail).not.toBeNull()
    expect(tail![0]!.role).toBe('user')
    expect(tail!.length).toBeGreaterThanOrEqual(20)
  })
})
