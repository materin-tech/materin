import { connectSse } from './sse'
import { renderEvent } from './render'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, unlinkSync } from 'node:fs'

async function api(base: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(base + path, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: init?.body,
  })
  if (!res.ok) throw new Error('API ' + path + ' -> ' + res.status)
  return res.json()
}

function createLocalServer(): Promise<{ base: string; close: () => void }> {
  return (async () => {
    const { createApp } = await import('@materin/server')
    const core = await import('@materin/core')
    const ai = await import('@materin/ai')

    const db = core.openDb()
    const store = new core.SessionStore(db)
    const bus = new core.Bus<import('@materin/core').AgentEvent>()
    const permissions = new core.PermissionManager(core.parsePermissionRules(process.env.MATERIN_PERMISSIONS))
    const tools = core.createDefaultTools({ store: store })

    const anthropicProvider = ai.createAnthropicProvider()
    const openaiProvider = ai.createOpenAIProvider()
    const resolveProvider = (model: string) => {
      const info = ai.getModel(model)
      const provider = info.api === 'anthropic' ? anthropicProvider : openaiProvider
      return { provider: provider, api: info.api }
    }

    const app = createApp({
      store: store,
      bus: bus,
      createAgent: process.env.TUI_STRIP2 ? (() => null as never) : (sid) =>
        new core.AgentSession(sid, {
          store: store,
          resolveProvider: resolveProvider,
          getModelInfo: ai.getModel,
          tools: tools,
          permissions: permissions,
          memory: new core.MemoryStore(join(homedir(), '.materin', 'memories', core.projectIdForCwd(store.getSession(sid)?.cwd ?? process.cwd()))),
        }),
      resolveProvider: resolveProvider,
      answerPermission: () => false,
      getDb: () => db,
    })
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch, idleTimeout: 255 })
    return { base: 'http://127.0.0.1:' + server.port, close: () => server.stop(true) }
  })()
}

async function oneShot(base: string, prompt: string, sessionArg?: string): Promise<void> {
  let sessionId = sessionArg
  if (!sessionId) {
    const created = (await api(base, '/session', {
      method: 'POST',
      body: JSON.stringify({ cwd: process.cwd() }),
    })) as { id: string }
    sessionId = created.id
  }
  let finalText = ''
  let finished = false
  const sse = connectSse(base, (data) => {
    try {
      const ev = JSON.parse(data) as {
        type: string
        delta?: { type: 'text' | 'thinking'; text: string }
        error?: string
      }
      if (ev.type === 'message_update' && ev.delta?.type === 'text' && ev.delta.text) {
        finalText += ev.delta.text
      }
      renderEvent(ev)
      if (ev.type === 'agent_end' || ev.type === 'agent_error') {
        finished = true
      }
    } catch {}
  })
  try {
    await api(base, '/session/' + sessionId + '/prompt', {
      method: 'POST',
      body: JSON.stringify({ text: prompt }),
    })
    while (!finished) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (finalText.trim().length > 0) process.stdout.write('\n' + finalText.trim() + '\n')
  } finally {
    sse.close()
  }
  process.exit(0)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const SKIP = (process.env.TUI_SKIP ?? '').split(',')
  // -d <dir> 数据根目录 (默认 ~/.materin); 必须在 openDb 之前设置
  const dIdx = args.indexOf('-d')
  if (dIdx >= 0 && args[dIdx + 1]) process.env.MATERIN_HOME = args[dIdx + 1]!

  if (args.includes('--version')) {
    const { VERSION } = await import('@materin/core')
    console.log('materin ' + VERSION)
    process.exit(0)
  }

  const core = await import('@materin/core')

  if (args[0] === 'reset') {
    const cfgPath = join(core.materinHome(), 'config.json')
    if (!existsSync(cfgPath)) {
      console.log('(config.json 不存在, 无需重置)')
      process.exit(0)
    }
    const answer = args.includes('--yes')
      ? 'y'
      : await new Promise<string>((resolve) => {
          process.stdout.write('重置模型 provider 配置? 将删除 ' + cfgPath + ' (y/N) ')
          process.stdin.once('data', (chunk: Buffer) => resolve(chunk.toString().trim().toLowerCase()))
        })
    if (answer === 'y') {
      unlinkSync(cfgPath)
      console.log('已重置。下次启动将重新引导配置。')
      process.exit(0)
    }
    console.log('已取消')
    process.exit(0)
  }

  if (args[0] === 'config') {
    const result = await core.runOnboarding(core.materinHome(), null)
    process.exit(result.configured ? 0 : 1)
  }

  // 首次启动: 未检测到任何模型 key 时交互式引导 (Claude Code/pi 同款逻辑)
  if (!SKIP.includes('onboarding')) {
    const onboard = await core.ensureModelConfigured()
  if (!onboard.configured) process.exit(1)
    if (!process.env.MATERIN_MODEL) process.env.MATERIN_MODEL = onboard.defaultModel
  }

  if (args[0] === 'init' || args.includes('--init')) {
    const force = args.includes('--force')
    const { migrateImportSkills } = await import('@materin/core')
    const result = await migrateImportSkills({ force: force })
    console.log('materin init: skills import')
    console.log('sources scanned: ' + (result.sources.length > 0 ? result.sources.join(', ') : '(none)'))
    for (const entry of result.copied) console.log('copied: ' + entry.name + ' <- ' + entry.from)
    for (const entry of result.skipped) {
      console.log('skipped: ' + entry.name + ' (' + entry.from + '); rerun with --force to overwrite')
    }
    if (result.copied.length === 0 && result.skipped.length === 0) console.log('nothing to import')
    process.exit(0)
  }
  const promptIndex = args.indexOf('-p')
  const prompt = promptIndex >= 0 ? args[promptIndex + 1] : undefined
  const sessionArg = args.includes('--session') ? args[args.indexOf('--session') + 1] : undefined

  const { base } = SKIP.includes('server') ? { base: 'http://127.0.0.1:1' } : await createLocalServer()

  if (prompt !== undefined) {
    await oneShot(base, prompt, sessionArg)
    return
  }

  // 按当前项目恢复会话 (不跨项目误恢复), 无则新建
  const { projectIdForCwd } = await import('@materin/core')
  const sessions = (await api(base, '/session?projectId=' + encodeURIComponent(projectIdForCwd(process.cwd())))) as Array<{ id: string }>
  let sessionId = sessions[0]?.id
  if (args.includes('--new')) sessionId = undefined
  if (!sessionId) {
    const created = (await api(base, '/session', {
      method: 'POST',
      body: JSON.stringify({ cwd: process.cwd() }),
    })) as { id: string }
    sessionId = created.id
  }

  // 审批模式恢复 (Shift+Tab 循环 plan/manual/auto/passon, 持久化到 session)
  let currentMode = 'manual'
  try {
    const s = (await api(base, '/session/' + sessionId)) as { permissionMode?: string }
    currentMode = s.permissionMode ?? 'manual'
  } catch {}

  // Ink 渲染: 必须在全部初始 fetch 之后 (Bun bug 涉及在途流式 fetch + stdin raw;
  // 此处不再持有流式 fetch, 之后的轮询均为瞬时短请求).
  const banner = '[materin] session ' + sessionId + ' — Shift+Tab 模式 · /help 命令 · Ctrl+C 中止/退出'
  const { renderApp } = await import('./components/render-app')
  const app = renderApp({
    version: core.VERSION,
    base: base,
    sessionId: sessionId,
    initialMode: currentMode,
    model: process.env.MATERIN_MODEL ?? 'claude-sonnet-5-5',
    banner: banner,
    onExit: () => {
      app.unmount()
      process.exit(0)
    },
  })
  await app.waitUntilExit()
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
