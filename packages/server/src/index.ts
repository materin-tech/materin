import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  openDb,
  SessionStore,
  Bus,
  AgentSession,
  createDefaultTools,
  createTaskTool,
  PermissionManager,
  parsePermissionRules,
  newId,
  materinHome,
  ensureModelConfigured,
  configuredProviders,
  loadConfig,
  applyConfigToEnv,
  MemoryStore,
  projectIdForCwd,
  loadExtensions,
  type AgentEvent,
  type LoadedExtensions,
  type Tool,
} from '@materin/core'
import { createAnthropicProvider, createOpenAIProvider, getModel } from '@materin/ai'
import { createApp } from './app'

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('usage: ' + (process.argv[1] ?? 'materin-server') + ' [-d <data-dir>]\n  env: see README (provider keys, MATERIN_PORT, MATERIN_MODEL, MATERIN_PERMISSIONS)')
  process.exit(0)
}

// -d <dir> 指定数据根目录 (默认 ~/.materin); 必须在 openDb 之前设置
const dIdx = process.argv.indexOf('-d')
if (dIdx > 0 && process.argv[dIdx + 1]) process.env.MATERIN_HOME = process.argv[dIdx + 1]!

const bootCfg = loadConfig()
applyConfigToEnv(bootCfg)
if (!process.env.MATERIN_MODEL && bootCfg?.defaultModel) process.env.MATERIN_MODEL = bootCfg.defaultModel
if (configuredProviders(bootCfg).length === 0) {
  console.error('未检测到模型配置。先运行: materin  (交互式配置)  或 export <PROVIDER>_API_KEY')
  process.exit(1)
}

const db = openDb()
const store = new SessionStore(db)
const bus = new Bus<AgentEvent>()
const permissions = new PermissionManager(parsePermissionRules(process.env.MATERIN_PERMISSIONS))

const anthropicProvider = createAnthropicProvider()
const openaiProvider = createOpenAIProvider()

function resolveProvider(model: string): { provider: typeof anthropicProvider; api: 'anthropic' | 'openai-completions' } {
  const info = getModel(model)
  const provider = info.api === 'anthropic' ? anthropicProvider : openaiProvider
  return { provider: provider, api: info.api }
}

// ---- extensions: global dir always; project dir only when the user trusts it ----

const extensionDirs: string[] = [join(materinHome(), 'extensions')]
const projectExtDir = join(process.cwd(), '.materin', 'extensions')
if (existsSync(join(projectExtDir, 'trust.json'))) extensionDirs.push(projectExtDir)

const extensionsHolder: { current: LoadedExtensions } = { current: await loadExtensions(extensionDirs) }

async function reloadExtensions(): Promise<void> {
  extensionsHolder.current = await loadExtensions(extensionDirs)
}

// ---- tools: base tools + task tool (child gets base tools only, no self-nesting) ----

const baseTools: Tool[] = createDefaultTools({ store: store })
const taskTool = createTaskTool({
  store: store,
  resolveProvider: resolveProvider,
  getModelInfo: getModel,
  childTools: baseTools,
  maxDepth: Number(process.env.MATERIN_SUBAGENT_DEPTH ?? '1'),
})
const tools: Tool[] = [...baseTools, taskTool]

// ---- memory: one store per project dir, shared by agent deps + reflection ----

function getMemoryStore(sessionId: string): MemoryStore {
  return new MemoryStore(
    join(materinHome(), 'memories', projectIdForCwd(store.getSession(sessionId)?.cwd ?? process.cwd())),
  )
}

const pendingAsks = new Map<string, (allow: boolean) => void>()

function onPermissionAsk(sessionId: string, tool: string, args: unknown): Promise<boolean> {
  const callId = newId()
  bus.emit({ type: 'permission_ask', sessionId: sessionId, callId: callId, tool: tool, args: args })
  return new Promise<boolean>((resolve) => {
    pendingAsks.set(callId, resolve)
    setTimeout(() => {
      if (pendingAsks.delete(callId)) resolve(false)
    }, 60_000)
  })
}

function answerPermission(callId: string, allow: boolean): boolean {
  const resolver = pendingAsks.get(callId)
  if (!resolver) return false
  pendingAsks.delete(callId)
  resolver(allow)
  return true
}

const app = createApp({
  store: store,
  bus: bus,
  createAgent: (sessionId) =>
    new AgentSession(sessionId, {
      store: store,
      resolveProvider: resolveProvider,
      getModelInfo: getModel,
      tools: tools,
      permissions: permissions,
      memory: getMemoryStore(sessionId),
      extensions: extensionsHolder.current,
      onPermissionAsk: onPermissionAsk,
    }),
  resolveProvider: resolveProvider,
  answerPermission: answerPermission,
  getExtensions: () => extensionsHolder.current,
  getMemory: getMemoryStore,
  reloadExtensions: reloadExtensions,
  reflect: async (sessionId) => {
    if (process.env.MATERIN_REFLECTION !== '1') return
    const session = store.getSession(sessionId)
    if (!session) return
    const { reflectAfterTurn } = await import('@materin/core')
    await reflectAfterTurn({
      store: store,
      memory: getMemoryStore(sessionId),
      resolveProvider: resolveProvider,
      model: process.env.MATERIN_REFLECTION_MODEL ?? session.model ?? 'claude-sonnet-5-5',
      sessionId: sessionId,
    })
  },
})

const port = Number(process.env.MATERIN_PORT ?? 4128)
Bun.serve({ port: port, hostname: '127.0.0.1', fetch: app.fetch, idleTimeout: 255 })
console.log(`materin server listening on http://127.0.0.1:${port}`)
