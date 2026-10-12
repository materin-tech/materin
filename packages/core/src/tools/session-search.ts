import { Type } from '@sinclair/typebox'
import type { SessionStore } from '../session/store'
import type { SearchHit } from '../session/search'
import type { Tool } from './types'

/**
 * session_search (M3 检索层): 跨会话全文检索历史消息 (FTS5 双表).
 */

const SessionSearchParams = Type.Object({
  query: Type.String({ description: 'Search phrase. Supports CJK substrings of 3+ characters.' }),
  limit: Type.Optional(Type.Number({ description: 'Max results (default 10)' })),
})

export function sessionSearchTool(store: SessionStore): Tool<typeof SessionSearchParams> {
  return {
    name: 'session_search',
    description:
      'Search across ALL past sessions\' messages (full-text). ' +
      'Use it to recall earlier conversations, decisions, or snippets the user mentioned before. ' +
      'Supports Chinese substrings of 3+ characters and English words/substrings.',
    parameters: SessionSearchParams,
    async execute(args) {
      try {
        const hits = store.search(args.query, args.limit ?? 10)
        if (hits.length === 0) return { content: 'No results.' }
        return { content: hits.map((h: SearchHit) => '[' + h.sessionId + '] ' + h.snippet).join('\n') }
      } catch (e) {
        return { content: 'session_search failed: ' + (e instanceof Error ? e.message : String(e)), isError: true }
      }
    },
  }
}
