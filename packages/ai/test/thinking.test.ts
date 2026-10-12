import { describe, test, expect } from 'bun:test'
import { normalizeThinking, anthropicThinking, openaiThinkingParams } from '../src/thinking'
import type { CompatFlags } from '../src/compat'

describe('normalizeThinking', () => {
  test('accepts the five levels case-insensitively', () => {
    expect(normalizeThinking('HIGH')).toBe('high')
    expect(normalizeThinking('XHigh')).toBe('xhigh')
    expect(normalizeThinking('Medium')).toBe('medium')
    expect(normalizeThinking(' low ')).toBe('low')
    expect(normalizeThinking('off')).toBe('off')
  })

  test('junk and missing input map to off', () => {
    expect(normalizeThinking('max')).toBe('off')
    expect(normalizeThinking('')).toBe('off')
    expect(normalizeThinking(null)).toBe('off')
    expect(normalizeThinking(undefined)).toBe('off')
    expect(normalizeThinking('123')).toBe('off')
  })
})

describe('anthropicThinking', () => {
  test('budgets per level and bumps max_tokens above budget', () => {
    expect(anthropicThinking('low', 8192)).toEqual({
      thinking: { type: 'enabled', budget_tokens: 4096 },
      max_tokens: 8192,
    })
    expect(anthropicThinking('high', 16384)).toEqual({
      thinking: { type: 'enabled', budget_tokens: 16384 },
      max_tokens: 20480,
    })
    expect(anthropicThinking('xhigh', 16384)).toEqual({
      thinking: { type: 'enabled', budget_tokens: 32768 },
      max_tokens: 36864,
    })
  })

  test('off returns no thinking key and unchanged max_tokens', () => {
    const result = anthropicThinking('off', 16384)
    expect(result.thinking).toBeUndefined()
    expect(result.max_tokens).toBe(16384)
  })

  test('requested max_tokens always exceeds budget', () => {
    const result = anthropicThinking('medium', 4096)
    expect(result.max_tokens).toBe(8192 + 4096)
    expect(result.max_tokens).toBeGreaterThan(8192)
  })
})

describe('openaiThinkingParams', () => {
  test('openai format: reasoning_effort, xhigh clamps to high, off omitted', () => {
    expect(openaiThinkingParams('medium', { thinkingFormat: 'openai' })).toEqual({ reasoning_effort: 'medium' })
    expect(openaiThinkingParams('xhigh', { thinkingFormat: 'openai' })).toEqual({ reasoning_effort: 'high' })
    expect(openaiThinkingParams('off', { thinkingFormat: 'openai' })).toEqual({})
  })

  test('qwen format: enable_thinking only when enabled', () => {
    expect(openaiThinkingParams('low', { thinkingFormat: 'qwen' })).toEqual({ enable_thinking: true })
    expect(openaiThinkingParams('off', { thinkingFormat: 'qwen' })).toEqual({})
  })

  test('zai format: thinking.type enabled only when enabled', () => {
    expect(openaiThinkingParams('high', { thinkingFormat: 'zai' })).toEqual({ thinking: { type: 'enabled' } })
    expect(openaiThinkingParams('off', { thinkingFormat: 'zai' })).toEqual({})
  })

  test('kimi and deepseek formats stay empty (provider defaults)', () => {
    expect(openaiThinkingParams('high', { thinkingFormat: 'kimi' })).toEqual({})
    expect(openaiThinkingParams('high', { thinkingFormat: 'deepseek' })).toEqual({})
    expect(openaiThinkingParams('high', undefined)).toEqual({})
  })
})
