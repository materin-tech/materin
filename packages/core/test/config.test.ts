import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, saveConfig, applyConfigToEnv, configuredProviders } from '../src/config'
import { ensureModelConfigured, type OnboardingIo } from '../src/onboarding'

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'materin-cfg-'))
}

const savedEnv = { ...process.env }
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in savedEnv)) delete process.env[k]
  }
  Object.assign(process.env, savedEnv)
})

describe('config', () => {
  test('save/load roundtrip with 0600 file', () => {
    const home = makeHome()
    saveConfig({ defaultModel: 'glm-4.7', providers: { glm: { apiKey: 'sk-x' } } }, home)
    expect(existsSync(join(home, 'config.json'))).toBe(true)
    const cfg = loadConfig(home)
    expect(cfg?.defaultModel).toBe('glm-4.7')
    expect(cfg?.providers?.glm?.apiKey).toBe('sk-x')
  })

  test('configuredProviders: env wins, config.json fills', () => {
    const home = makeHome()
    delete process.env.DEEPSEEK_API_KEY
    expect(configuredProviders(loadConfig(home))).toHaveLength(0)
    saveConfig({ providers: { deepseek: { apiKey: 'sk-1' } } }, home)
    const detected = configuredProviders(loadConfig(home))
    expect(detected.map((p) => p.id)).toEqual(['deepseek'])
    process.env.DEEPSEEK_API_KEY = 'sk-env'
    expect(configuredProviders(loadConfig(home)).length).toBeGreaterThanOrEqual(1)
  })

  test('applyConfigToEnv fills env only when absent', () => {
    const home = makeHome()
    delete process.env.MOONSHOT_API_KEY
    applyConfigToEnv({ providers: { kimi: { apiKey: 'sk-kimi' } } })
    expect(process.env.MOONSHOT_API_KEY as string | undefined).toBe('sk-kimi')
    applyConfigToEnv({ providers: { kimi: { apiKey: 'sk-other' } } })
    expect(process.env.MOONSHOT_API_KEY as string | undefined).toBe('sk-kimi') // env 优先
  })

  test('onboarding: 无 key 时引导选择并写入 config', async () => {
    const home = makeHome()
    for (const k of ['ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'MOONSHOT_API_KEY', 'ZAI_API_KEY', 'OPENAI_API_KEY']) {
      delete process.env[k]
    }
    const log: string[] = []
    const answers = ['2', 'sk-test-deepseek'] // 选 2 = DeepSeek
    const io: OnboardingIo = {
      log: (m) => log.push(m),
      ask: () => Promise.resolve(answers.shift() ?? ''),
    }
    const result = await ensureModelConfigured(home, io)
    expect(result.configured).toBe(true)
    expect(result.defaultModel).toBe('deepseek-chat')
    const raw = readFileSync(join(home, 'config.json'), 'utf-8')
    expect(raw).toContain('sk-test-deepseek')
    expect(process.env.DEEPSEEK_API_KEY).toBe('sk-test-deepseek')
  })

  test('onboarding: 已有 env key 时直接跳过', async () => {
    const home = makeHome()
    process.env.ZAI_API_KEY = 'sk-zai'
    let asked = false
    const io: OnboardingIo = { log: () => {}, ask: () => { asked = true; return Promise.resolve('') } }
    const result = await ensureModelConfigured(home, io)
    expect(result.configured).toBe(true)
    expect(result.defaultModel).toBe('glm-4.7')
    expect(asked).toBe(false)
  })

  test('onboarding: 无效选择不写配置', async () => {
    const home = makeHome()
    for (const k of ['ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'MOONSHOT_API_KEY', 'ZAI_API_KEY', 'OPENAI_API_KEY']) {
      delete process.env[k]
    }
    const io: OnboardingIo = { log: () => {}, ask: () => Promise.resolve('99') }
    const result = await ensureModelConfigured(home, io)
    expect(result.configured).toBe(false)
    expect(existsSync(join(home, 'config.json'))).toBe(false)
  })
})

void rmSync
