import type { Provider, StreamEvent } from '@materin/ai'
import { rowToAiMessage, type MessageRow, type SessionStore } from '../session/store'

/**
 * Compaction (M2, plan section 6 simplified): one LLM summary call replaces the context view.
 * Storage stays append-only: only a compaction row is added; the tree and leaf are untouched.
 */

export const SUMMARIZE_PROMPT = [
  'Summarize the conversation so far for a coding agent continuing the task.',
  'Sections:',
  '1. Task state: completed vs remaining.',
  '2. Key decisions and constraints.',
  '3. Files created or modified.',
  '4. Next steps.',
  'Keep names, paths, and command lines exactly as they appeared.',
].join('\n')

const TAIL_SIZE = 20
const MIN_HEAD = 4

export interface CompactionResult {
  summary: string
  tokensBefore: number
}

export type ResolveProvider = (model: string) => { provider: Provider; api: 'anthropic' | 'openai-completions' }

export async function compact(
  store: SessionStore,
  resolveProvider: ResolveProvider,
  model: string,
  sessionId: string,
  opts: { model?: string } = {},
): Promise<CompactionResult | null> {
  const chain = store.getMessagesToLeaf(sessionId)
  const tail = selectTail(chain)
  if (tail === null) return null
  const head = chain.slice(0, chain.length - tail.length)
  if (head.length < MIN_HEAD) return null

  const summaryModel = opts.model ?? model
  const { provider } = resolveProvider(summaryModel)
  const tokensBefore = latestAssistantInput(chain)

  const summary = await runSummaryCall(provider, summaryModel, head)
  if (summary === null) return null

  store.addCompaction({
    sessionId: sessionId,
    summary: summary,
    tokensBefore: tokensBefore,
    anchorMessageId: tail[0] ? tail[0].id : null,
  })
  return { summary: summary, tokensBefore: tokensBefore }
}

export function selectTail(chain: MessageRow[]): MessageRow[] | null {
  const first = chain[0]
  if (chain.length <= TAIL_SIZE && first && first.role === 'user') return null
  const last = chain.slice(-TAIL_SIZE)
  let start = chain.length - last.length
  while (start > 0) {
    const row = chain[start]
    if (!row || row.role === 'user') break
    start -= 1
  }
  return chain.slice(start)
}

function latestAssistantInput(chain: MessageRow[]): number {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const row = chain[i]
    if (row && row.role === 'assistant' && row.usage) return row.usage.input
  }
  return 0
}

async function runSummaryCall(
  provider: Provider,
  summaryModel: string,
  head: MessageRow[],
): Promise<string | null> {
  const ctx = {
    systemPrompt: SUMMARIZE_PROMPT,
    messages: head.map(rowToAiMessage),
    tools: [],
    model: summaryModel,
    maxTokens: 2000,
  }
  let summary = ''
  for await (const ev of provider.stream(ctx)) {
    if (ev.type === 'text_delta') {
      summary += ev.delta
    } else if (ev.type === 'error') {
      return null
    }
  }
  const trimmed = summary.trim()
  return trimmed.length > 0 ? trimmed : null
}
