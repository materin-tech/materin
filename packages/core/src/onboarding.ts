import {
  PROVIDER_PRESETS,
  configuredProviders,
  loadConfig,
  saveConfig,
  applyConfigToEnv,
  materinHome,
  type MaterinConfig,
} from './config'

/**
 * 首次启动 onboarding (对齐 Claude Code/pi/opencode):
 * 未检测到任何模型 key (env 或 config.json) 时, 交互式引导选 provider + 输入 key,
 * 写入 <home>/.materin/config.json (0600). 解析顺序: env > config.json.
 * home 默认 materinHome() (MATERIN_HOME env 或 ~/.materin), 可被 -d 覆盖.
 */

export interface OnboardingIo {
  log(msg: string): void
  ask(prompt: string): Promise<string>
}

export function defaultIo(): OnboardingIo {
  return {
    log: (msg: string) => console.log(msg),
    ask: (prompt: string) =>
      new Promise((resolve) => {
        process.stdout.write(prompt)
        process.stdin.once('data', (chunk: Buffer) => resolve(chunk.toString().trim()))
      }),
  }
}

export interface OnboardResult {
  configured: boolean
  defaultModel?: string
}

export async function ensureModelConfigured(homeDir?: string, io: OnboardingIo = defaultIo()): Promise<OnboardResult> {
  const home = homeDir ?? materinHome()
  const cfg = loadConfig(home)
  applyConfigToEnv(cfg)
  const available = configuredProviders(cfg)
  if (available.length > 0) {
    return { configured: true, defaultModel: cfg?.defaultModel ?? available[0]!.defaultModel }
  }
  return runOnboarding(home, cfg, io)
}

/** 强制重新配置 (materin config). */
export async function runOnboarding(home: string, cfg: MaterinConfig | null, io: OnboardingIo = defaultIo()): Promise<OnboardResult> {
  io.log('')
  io.log('\x1b[36m欢迎使用 materin — 需要配置一个模型 provider\x1b[0m')
  io.log('选择要配置的服务 (之后也可用环境变量覆盖):')
  for (let i = 0; i < PROVIDER_PRESETS.length; i++) {
    const p = PROVIDER_PRESETS[i]!
    io.log('  [' + (i + 1) + '] ' + p.label + '  (' + p.apiKeyEnv + ')')
  }
  const answer = await io.ask('#> ')
  const idx = Number.parseInt(answer, 10)
  const preset = Number.isInteger(idx) ? PROVIDER_PRESETS[idx - 1] : undefined
  if (!preset) {
    io.log('无效选择, 退出。可重新运行完成配置。')
    return { configured: false }
  }
  const apiKey = await io.ask(preset.label + ' API Key: ')
  if (!apiKey) {
    io.log('未输入 key, 退出。可重新运行完成配置。')
    return { configured: false }
  }
  const baseUrl = await io.ask('Base URL (回车=官方默认, 私有化部署填自己的地址): ')
  const model = await io.ask('默认模型 (回车=' + preset.defaultModel + '): ')
  const next: MaterinConfig = cfg ?? {}
  next.providers = { ...(next.providers ?? {}), [preset.id]: { apiKey, ...(baseUrl ? { baseUrl } : {}) } }
  next.defaultModel = model || preset.defaultModel
  saveConfig(next, home)
  applyConfigToEnv(next)
  io.log('已写入 ' + home + '/config.json (0600)')
  return { configured: true, defaultModel: preset.defaultModel }
}
