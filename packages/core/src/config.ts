import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 模型配置: ~/.materin/config.json (0600).
 * 解析顺序: 环境变量 > config.json. 首次启动无任何 key 时由 onboarding 引导写入.
 */

export interface ProviderPreset {
  id: string
  label: string
  apiKeyEnv: string
  baseUrlEnv?: string
  defaultModel: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'anthropic', label: 'Claude (Anthropic)', apiKeyEnv: 'ANTHROPIC_API_KEY', baseUrlEnv: 'ANTHROPIC_BASE_URL', defaultModel: 'claude-sonnet-5-5' },
  { id: 'deepseek', label: 'DeepSeek', apiKeyEnv: 'DEEPSEEK_API_KEY', baseUrlEnv: 'DEEPSEEK_BASE_URL', defaultModel: 'deepseek-chat' },
  { id: 'qwen', label: 'Qwen 通义 (DashScope)', apiKeyEnv: 'DASHSCOPE_API_KEY', baseUrlEnv: 'DASHSCOPE_BASE_URL', defaultModel: 'qwen-plus' },
  { id: 'kimi', label: 'Kimi (Moonshot)', apiKeyEnv: 'MOONSHOT_API_KEY', baseUrlEnv: 'MOONSHOT_BASE_URL', defaultModel: 'kimi-k2' },
  { id: 'glm', label: '智谱 GLM', apiKeyEnv: 'ZAI_API_KEY', baseUrlEnv: 'ZAI_BASE_URL', defaultModel: 'glm-4.7' },
  { id: 'openai', label: 'OpenAI', apiKeyEnv: 'OPENAI_API_KEY', baseUrlEnv: 'OPENAI_BASE_URL', defaultModel: 'gpt-5.1' },
]

export interface MaterinConfig {
  defaultModel?: string
  providers?: Record<string, { apiKey?: string; baseUrl?: string }>
}

/** materin 数据根目录: MATERIN_HOME env 优先, 默认 ~/.materin (-d 标志在入口设置 MATERIN_HOME). */
export function materinHome(): string {
  return process.env.MATERIN_HOME ?? join(homedir(), '.materin')
}

export function configPath(homeDir: string = materinHome()): string {
  return join(homeDir, 'config.json')
}

export function loadConfig(homeDir: string = materinHome()): MaterinConfig | null {
  const path = configPath(homeDir)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as MaterinConfig
  } catch {
    return null
  }
}

export function saveConfig(cfg: MaterinConfig, homeDir: string = materinHome()): void {
  const path = configPath(homeDir)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
}

/** env 优先, config.json 补位 — 启动时调用一次. */
export function applyConfigToEnv(cfg: MaterinConfig | null): void {
  if (!cfg?.providers) return
  for (const preset of PROVIDER_PRESETS) {
    const entry = cfg.providers[preset.id]
    if (!entry) continue
    if (entry.apiKey && !process.env[preset.apiKeyEnv]) process.env[preset.apiKeyEnv] = entry.apiKey
    if (entry.baseUrl && preset.baseUrlEnv && !process.env[preset.baseUrlEnv]) process.env[preset.baseUrlEnv] = entry.baseUrl
  }
}

/** 已可用的 provider (env 或 config.json 任一有 key). */
export function configuredProviders(cfg: MaterinConfig | null): ProviderPreset[] {
  return PROVIDER_PRESETS.filter((p) => {
    if (process.env[p.apiKeyEnv]) return true
    if (p.id === 'anthropic' && process.env.ANTHROPIC_AUTH_TOKEN) return true
    return Boolean(cfg?.providers?.[p.id]?.apiKey)
  })
}
