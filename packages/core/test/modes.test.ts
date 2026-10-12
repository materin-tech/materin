import { describe, test, expect } from 'bun:test'
import { normalizeMode, nextMode, resolveToolDecision, MODE_CYCLE } from '../src/agent/modes'

describe('resolveToolDecision matrix', () => {
  test('plan: edit/write denied, reads allowed, others follow rules', () => {
    expect(resolveToolDecision('plan', 'edit', 'allow')).toBe('deny')
    expect(resolveToolDecision('plan', 'write', 'allow')).toBe('deny')
    expect(resolveToolDecision('plan', 'read', 'ask')).toBe('allow')
    expect(resolveToolDecision('plan', 'session_search', 'ask')).toBe('allow')
    expect(resolveToolDecision('plan', 'bash', 'allow')).toBe('allow')
    expect(resolveToolDecision('plan', 'bash', 'ask')).toBe('ask')
    expect(resolveToolDecision('plan', 'bash', 'deny')).toBe('deny')
  })

  test('passon: bypasses everything except explicit deny', () => {
    expect(resolveToolDecision('passon', 'bash', 'ask')).toBe('allow')
    expect(resolveToolDecision('passon', 'edit', 'ask')).toBe('allow')
    expect(resolveToolDecision('passon', 'write', 'deny')).toBe('deny')
  })

  test('auto: ask becomes allow, deny stays deny', () => {
    expect(resolveToolDecision('auto', 'bash', 'ask')).toBe('allow')
    expect(resolveToolDecision('auto', 'bash', 'deny')).toBe('deny')
    expect(resolveToolDecision('auto', 'edit', 'allow')).toBe('allow')
  })

  test('manual: rule decision passthrough', () => {
    expect(resolveToolDecision('manual', 'bash', 'ask')).toBe('ask')
    expect(resolveToolDecision('manual', 'bash', 'allow')).toBe('allow')
    expect(resolveToolDecision('manual', 'bash', 'deny')).toBe('deny')
  })
})

describe('mode cycle', () => {
  test('nextMode cycles manual -> auto -> plan -> passon -> manual', () => {
    expect(nextMode('manual')).toBe('auto')
    expect(nextMode('auto')).toBe('plan')
    expect(nextMode('plan')).toBe('passon')
    expect(nextMode('passon')).toBe('manual')
  })

  test('MODE_CYCLE order', () => {
    expect(MODE_CYCLE).toEqual(['manual', 'auto', 'plan', 'passon'])
  })

  test('normalizeMode maps junk to manual', () => {
    expect(normalizeMode('garbage')).toBe('manual')
    expect(normalizeMode(undefined)).toBe('manual')
    expect(normalizeMode('PLAN')).toBe('plan')
    expect(normalizeMode(null)).toBe('manual')
  })
})
