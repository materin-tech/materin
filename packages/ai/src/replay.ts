import type { Message } from './types'

/**
 * 跨 provider 上下文切换 (pi-ai 的 cross-provider handoff):
 * 异 provider 的 thinking block 回放时降级为 <thinking> 文本;
 * 同 provider 原样保留 (含 cache 友好的字节级结构).
 */

export function replayFilter(messages: Message[], targetApi: 'anthropic' | 'openai-completions'): Message[] {
  return messages.map((m) => {
    if (m.role !== 'assistant') return m
    const sameProvider = m.provider === targetApi
    if (sameProvider) return m
    return {
      ...m,
      content: m.content.map((b) => {
        if (b.type !== 'thinking') return b
        return { type: 'text', text: `<thinking>${b.thinking}</thinking>` } as const
      }),
    }
  })
}
