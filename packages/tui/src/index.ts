import { connectSse } from './sse'
import { renderEvent } from './render'
import { homedir } from 'node:os'
import { join } from 'node:path'

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
      createAgent: (sid) =>
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
  if (args.includes('--version')) {
    const { VERSION } = await import('@materin/core')
    console.log('materin ' + VERSION)
    process.exit(0)
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

  const { base } = await createLocalServer()

  if (prompt !== undefined) {
    await oneShot(base, prompt, sessionArg)
    return
  }

  const sessions = (await api(base, '/session')) as Array<{ id: string }>
  let sessionId = sessions[0]?.id
  if (args.includes('--new')) sessionId = undefined
  if (!sessionId) {
    const created = (await api(base, '/session', {
      method: 'POST',
      body: JSON.stringify({ cwd: process.cwd() }),
    })) as { id: string }
    sessionId = created.id
  }

  console.log('\x1b[2m[materin] session ' + sessionId + '\x1b[0m')
  connectSse(base, (data) => {
    try {
      renderEvent(JSON.parse(data))
    } catch {}
  })

  const readline = await import('node:readline')
  const rl = readline.createInterface({ input: process.stdin })
  rl.setPrompt('> ')
  rl.prompt()

  rl.on('line', (line: string) => {
    const text = line.trim()
    if (!text) return
    if (text === '/exit') process.exit(0)
    api(base, '/session/' + sessionId + '/prompt', {
      method: 'POST',
      body: JSON.stringify({ text: text }),
    }).catch((e: unknown) => {
      console.error('error: ' + (e instanceof Error ? e.message : String(e)))
    })
  })

  process.on('SIGINT', () => {
    void api(base, '/session/' + sessionId + '/abort', { method: 'POST' })
  })

  setInterval(() => {}, 60_000)
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
