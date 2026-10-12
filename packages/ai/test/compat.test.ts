import { describe, test, expect, afterEach } from 'bun:test'
import { getModel, resolveModel, listAvailableModels, listModels } from '../src/compat'

describe('model aliases', () => {
  test('tier aliases resolve to canonical registry ids', () => {
    expect(getModel('sonnet')).toEqual(getModel('claude-sonnet-5-5'))
    expect(getModel('opus')).toEqual(getModel('claude-opus-5-5'))
    expect(getModel('haiku')).toEqual(getModel('claude-haiku-4-5'))
    expect(getModel('glm')).toEqual(getModel('glm-4.7'))
    expect(getModel('deepseek-r1')).toEqual(getModel('deepseek-reasoner'))
  })

  test('resolveModel returns the canonical id for aliases', () => {
    expect(resolveModel('sonnet').id).toBe('claude-sonnet-5-5')
    expect(resolveModel('glm').id).toBe('glm-4.7')
    expect(resolveModel('kimi').id).toBe('kimi-k2')
    expect(resolveModel('qwen').id).toBe('qwen-plus')
    expect(resolveModel('deepseek').id).toBe('deepseek-chat')
  })

  test('exact registry ids pass through unchanged', () => {
    expect(resolveModel('claude-sonnet-5-5').id).toBe('claude-sonnet-5-5')
    expect(resolveModel('claude-sonnet-5-5').info.api).toBe('anthropic')
  })

  test('unknown models fall back with raw id preserved', () => {
    const resolved = resolveModel('totally-unknown-model')
    expect(resolved.id).toBe('totally-unknown-model')
    expect(resolved.info.api).toBe('openai-completions')
    expect(resolveModel('claude-9-9').info.api).toBe('anthropic')
  })
})

describe('listAvailableModels', () => {
  const hadKey = 'ZAI_API_KEY' in process.env
  const prevValue = process.env.ZAI_API_KEY

  afterEach(() => {
    if (hadKey) process.env.ZAI_API_KEY = prevValue
    else delete process.env.ZAI_API_KEY
  })

  test('lists registry with configured flag reflecting env', () => {
    delete process.env.ZAI_API_KEY
    let entries = listAvailableModels()
    const glm = entries.find((m) => m.id === 'glm-4.7')
    expect(glm).toBeTruthy()
    expect(glm!.configured).toBe(false)

    process.env.ZAI_API_KEY = 'test-key'
    entries = listAvailableModels()
    expect(entries.find((m) => m.id === 'glm-4.7')!.configured).toBe(true)
    expect(entries.every((m) => typeof m.api === 'string' && m.contextWindow > 0)).toBe(true)
    expect(listModels()).toContain('glm-4.7')
  })
})
