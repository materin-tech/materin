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

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('usage: ' + (process.argv[1] ?? 'materin-gateway') + ' [command] [-d <data-dir>]\n' +
    'commands:\n' +
    '  (无参数)          后台启动 (daemon)\n' +
    '  fg                前台运行 (调试用)\n' +
    '  start|stop|status|logs|restart   daemon 管理\n' +
    '  install-service   安装系统服务 (macOS launchd / Linux systemd, 开机自启)\n' +
    '  uninstall-service 移除系统服务\n' +
    '  -d <dir>          数据根目录 (默认 ~/.materin)')
  process.exit(0)
}

// -d <dir> 指定数据根目录 (默认 ~/.materin); 必须在 openDb 之前设置
const dIdx = process.argv.indexOf('-d')
if (dIdx > 0 && process.argv[dIdx + 1]) process.env.MATERIN_HOME = process.argv[dIdx + 1]!

const GATEWAY_COMMANDS = ['start', 'stop', 'status', 'logs', 'restart', 'fg', 'install-service', 'uninstall-service'] as const
const gCmd = process.argv.slice(2).find((a) => (GATEWAY_COMMANDS as readonly string[]).includes(a))
const NO_CONFIG_CMDS = ['stop', 'status', 'logs', 'uninstall-service']
if (gCmd && !NO_CONFIG_CMDS.includes(gCmd) || !gCmd) {
  const bootCfg = loadConfig()
  applyConfigToEnv(bootCfg)
  if (!process.env.MATERIN_MODEL && bootCfg?.defaultModel) process.env.MATERIN_MODEL = bootCfg.defaultModel
  if (configuredProviders(bootCfg).length === 0) {
    console.error('未检测到模型配置。先运行: materin  (交互式配置)  或 export <PROVIDER>_API_KEY')
    process.exit(1)
  }
}

/** 已配置的渠道 (与下方适配器注册同源判断). */
function channelsConfigured(): string[] {
  const channels: string[] = []
  if (process.env.FEISHU_APP_ID) channels.push('feishu')
  if (process.env.DINGTALK_APP_KEY) channels.push('dingtalk')
  if (process.env.WECOM_CORP_ID && process.env.WECOM_TOKEN) channels.push('wecom')
  if (process.env.MATERIN_GATEWAY_CONSOLE === '1') channels.push('console')
  return channels
}

const isDaemonChild = process.argv.includes('--daemon-child')
const needsChannelCheck = !gCmd || !NO_CONFIG_CMDS.includes(gCmd)
if (needsChannelCheck && !isDaemonChild && channelsConfigured().length === 0) {
  console.error('未检测到渠道配置。gateway 需要至少一个渠道才能启动, 设置以下任一环境变量:')
  console.error('  FEISHU_APP_ID / FEISHU_APP_SECRET                          (飞书, WS 长连接, 免公网 IP)')
  console.error('  DINGTALK_APP_KEY / DINGTALK_APP_SECRET                     (钉钉, Stream 模式)')
  console.error('  WECOM_CORP_ID + WECOM_TOKEN (+ SECRET/AGENT_ID/AES_KEY)    (企业微信)')
  console.error('  MATERIN_GATEWAY_CONSOLE=1                                  (本地 stdin/stdout, 测试用)')
  console.error('文档: packages/gateway/README.md')
  process.exit(1)
}

// daemon/服务命令: 不进入网关主流程
import { daemonStart, daemonStop, daemonStatus, daemonLogs } from './daemon'
import { serviceInstall, serviceUninstall } from './service'
if (gCmd === 'fg' || isDaemonChild) {
  // 前台运行 (或 daemon 子进程): 继续走主流程
} else if (gCmd === 'start') {
  process.exit(daemonStart())
} else if (gCmd === 'restart') {
  daemonStop()
  process.exit(daemonStart())
} else if (gCmd === 'stop') {
  process.exit(daemonStop())
} else if (gCmd === 'status') {
  process.exit(daemonStatus())
} else if (gCmd === 'logs') {
  process.exit(daemonLogs(process.argv.includes('-f')))
} else if (gCmd === 'install-service') {
  process.exit(serviceInstall())
} else if (gCmd === 'uninstall-service') {
  process.exit(serviceUninstall())
} else if (!gCmd) {
  // 默认: 后台启动
  process.exit(daemonStart())
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
