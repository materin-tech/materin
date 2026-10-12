import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  openDb,
  SessionStore,
  createDefaultTools,
  createTaskTool,
  PermissionManager,
  parsePermissionRules,
  MemoryStore,
  projectIdForCwd,
  loadExtensions,
  materinHome,
  ensureModelConfigured,
  configuredProviders,
  loadConfig,
  applyConfigToEnv,
} from '@materin/core'
import { createAnthropicProvider, createOpenAIProvider, getModel } from '@materin/ai'
import { Gateway } from './gateway'
import { FeishuAdapter } from './adapters/feishu'
import { DingtalkAdapter } from './adapters/dingtalk'
import { WecomAdapter } from './adapters/wecom'
import { ConsoleAdapter } from './adapters/console'

/**
 * gateway binary: 按环境变量注册渠道适配器并启动.
 */

// -d <dir> 指定数据根目录 (默认 ~/.materin); 必须在 openDb 之前设置
const dIdx = process.argv.indexOf('-d')
if (dIdx > 0 && process.argv[dIdx + 1]) process.env.MATERIN_HOME = process.argv[dIdx + 1]!

const bootCfg = loadConfig()
applyConfigToEnv(bootCfg)
if (configuredProviders(bootCfg).length === 0) {
  console.error('未检测到模型配置。先运行: materin  (交互式配置)  或 export <PROVIDER>_API_KEY')
  process.exit(1)
}

const db = openDb()
const store = new SessionStore(db)

const extensionDirs: string[] = [join(materinHome(), 'extensions')]
const projectExtDir = join(process.cwd(), '.materin', 'extensions')
if (existsSync(join(projectExtDir, 'trust.json'))) extensionDirs.push(projectExtDir)
const extensions = await loadExtensions(extensionDirs)

const baseTools = createDefaultTools({ store: store })
const taskTool = createTaskTool({
  store: store,
  resolveProvider: resolveProvider,
  getModelInfo: getModel,
  childTools: baseTools,
  maxDepth: Number(process.env.MATERIN_SUBAGENT_DEPTH ?? '1'),
})
const tools = [...baseTools, taskTool]

function memoryFor(sessionId: string): MemoryStore {
  return new MemoryStore(
    join(materinHome(), 'memories', projectIdForCwd(store.getSession(sessionId)?.cwd ?? process.cwd())),
  )
}
const permissions = new PermissionManager(
  parsePermissionRules(process.env.MATERIN_CHANNEL_PERMISSIONS ?? 'bash:deny;write:deny;edit:deny'),
)

const anthropicProvider = createAnthropicProvider()
const openaiProvider = createOpenAIProvider()

function resolveProvider(model: string): { provider: typeof anthropicProvider | typeof openaiProvider; api: 'anthropic' | 'openai-completions' } {
  const info = getModel(model)
  const provider = info.api === 'anthropic' ? anthropicProvider : openaiProvider
  return { provider: provider, api: info.api }
}

const gateway = new Gateway({
  store: store,
  resolveProvider: resolveProvider,
  getModelInfo: getModel,
  tools: tools,
  permissions: permissions,
  extensions: extensions,
  memoryFor: memoryFor,
})

const registered: string[] = []

if (process.env.FEISHU_APP_ID) {
  gateway.registerAdapter(
    new FeishuAdapter({ appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET ?? '' }),
  )
  registered.push('feishu')
}
if (process.env.DINGTALK_APP_KEY) {
  gateway.registerAdapter(
    new DingtalkAdapter({ appKey: process.env.DINGTALK_APP_KEY, appSecret: process.env.DINGTALK_APP_SECRET ?? '' }),
  )
  registered.push('dingtalk')
}
if (process.env.WECOM_CORP_ID && process.env.WECOM_TOKEN) {
  gateway.registerAdapter(
    new WecomAdapter({
      corpId: process.env.WECOM_CORP_ID,
      corpSecret: process.env.WECOM_CORP_SECRET ?? '',
      agentId: Number(process.env.WECOM_AGENT_ID ?? '0'),
      token: process.env.WECOM_TOKEN,
      encodingAesKey: process.env.WECOM_ENCODING_AES_KEY ?? '',
      port: Number(process.env.MATERIN_WECOM_PORT ?? '4190'),
    }),
  )
  registered.push('wecom')
}
if (process.env.MATERIN_GATEWAY_CONSOLE === '1') {
  gateway.registerAdapter(new ConsoleAdapter())
  registered.push('console')
}

if (registered.length === 0) {
  console.log(
    'No gateway channel configured. Set one of:\n' +
      '  FEISHU_APP_ID / FEISHU_APP_SECRET            (飞书, WSClient long connection)\n' +
      '  DINGTALK_APP_KEY / DINGTALK_APP_SECRET       (钉钉, dingtalk-stream)\n' +
      '  WECOM_CORP_ID + WECOM_TOKEN (+ others)       (企业微信, callback URL on MATERIN_WECOM_PORT)\n' +
      '  MATERIN_GATEWAY_CONSOLE=1                    (local stdin/stdout, for smoke testing)\n' +
      '\n' +
      'Optional: MATERIN_CHANNEL_PERMISSIONS (default "bash:deny;write:deny;edit:deny"), MATERIN_MODEL, MATERIN_WECOM_PORT.',
  )
  process.exit(1)
}

const env: string[] = []
if (process.env.MATERIN_CHANNEL_PERMISSIONS) env.push('MATERIN_CHANNEL_PERMISSIONS=' + process.env.MATERIN_CHANNEL_PERMISSIONS)
if (process.env.MATERIN_MODEL) env.push('MATERIN_MODEL=' + process.env.MATERIN_MODEL)

console.log('materin gateway starting, adapters: ' + registered.join(', ') + (env.length > 0 ? ' | ' + env.join(' ') : ''))
gateway
  .start()
  .then(() => {
    console.log('materin gateway ready')
  })
  .catch((e: unknown) => {
    console.error('gateway start failed: ' + (e instanceof Error ? e.message : String(e)))
    process.exit(1)
  })
