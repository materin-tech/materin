import type { CompatFlags } from './compat'

/**
 * Thinking-depth selection (Claude Code 风格), cross-provider.
 * Pure functions only: normalize + per-wire-API request-body fragments.
 */

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh'

export const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh']

const ANTHROPIC_BUDGETS: Record<Exclude<ThinkingLevel, 'off'>, number> = {
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
}

const MIN_HEADROOM = 4096

export function normalizeThinking(input?: string | null): ThinkingLevel {
  if (!input) return 'off'
  const lower = input.trim().toLowerCase()
  return (THINKING_LEVELS as readonly string[]).includes(lower) ? (lower as ThinkingLevel) : 'off'
}

export interface AnthropicThinkingResult {
  thinking?: { type: 'enabled'; budget_tokens: number }
  max_tokens: number
}

/**
 * Anthropic Messages: add `thinking` and bump `max_tokens` so it stays above
 * the budget (API requires max_tokens > budget_tokens). 'off' -> no thinking key.
 */
export function anthropicThinking(level: ThinkingLevel, requestedMaxTokens: number): AnthropicThinkingResult {
  if (level === 'off') return { max_tokens: requestedMaxTokens }
  const budget = ANTHROPIC_BUDGETS[level]
  return {
    thinking: { type: 'enabled', budget_tokens: budget },
    max_tokens: Math.max(requestedMaxTokens, budget + MIN_HEADROOM),
  }
}

/** Extra body params for OpenAI-compatible providers, keyed by compat.thinkingFormat. */
export function openaiThinkingParams(level: ThinkingLevel, compat?: CompatFlags): Record<string, unknown> {
  switch (compat?.thinkingFormat) {
    case 'openai': {
      const effort = level === 'xhigh' ? 'high' : level === 'off' ? undefined : level
      return effort ? { reasoning_effort: effort } : {}
    }
    case 'qwen':
      return level !== 'off' ? { enable_thinking: true } : {}
    case 'zai':
      return level !== 'off' ? { thinking: { type: 'enabled' } } : {}
    case 'kimi':
    case 'deepseek':
    default:
      return {}
  }
}
