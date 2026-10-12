import { join, dirname, resolve, isAbsolute } from 'node:path'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  compact,
  normalizeMode,
  parseInput,
  listFiles,
  loadConfig,
  saveConfig,
  applyConfigToEnv,
  PROVIDER_PRESETS,
  type MaterinConfig,
  type ResolveProvider,
  type MemoryStore,
} from '@materin/core'
import type { AgentEvent, AgentSession, Bus, LoadedExtensions, SessionStore } from '@materin/core'
import { listAvailableModels, normalizeThinking, resolveModel } from '@materin/ai'
import type { ImageBlock } from '@materin/ai'
import { openApiSpec } from './openapi'
import { buildCommandRegistry, type CommandRegistry } from './commands'

/**
 * Server-first architecture: all state flows over HTTP + SSE.
 */

export interface ServerDeps {
  store: SessionStore
  bus: Bus<AgentEvent>
  createAgent: (sessionId: string) => AgentSession
  resolveProvider: ResolveProvider
  answerPermission: (callId: string, allow: boolean) => boolean
  getExtensions?: () => LoadedExtensions | undefined
  reloadExtensions?: () => Promise<void>
  reflect?: (sessionId: string) => Promise<void>
  getMemory?: (sessionId: string) => MemoryStore
}

export function createApp(deps: ServerDeps): Hono {
  const { store, bus, createAgent, resolveProvider, answerPermission } = deps
  const app = new Hono()
  const running = new Map<string, AbortController>()
  const registry: CommandRegistry = buildCommandRegistry({
    store: store,
    resolveProvider: resolveProvider,
    getMemory: deps.getMemory,
    getExtensions: deps.getExtensions,
  })

  app.get('/', (c) => c.json({ name: 'materin-server', version: '0.1.0' }))

  // ---- active workspace: new sessions default to it; GUI can switch anytime ----
  let activeWorkspace = process.env.MATERIN_WORKSPACE ?? process.cwd()

  app.get('/workspace', (c) => c.json({ workspace: activeWorkspace }))

  app.post('/workspace', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { cwd?: string }
    const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : ''
    if (cwd.length === 0 || !isAbsolute(cwd)) return c.json({ error: 'cwd must be an absolute path' }, 400)
    try {
      mkdirSync(cwd, { recursive: true })
      activeWorkspace = resolve(cwd)
      return c.json({ workspace: activeWorkspace })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ error: message }, 400)
    }
  })

  app.get('/fs/dirs', (c) => {
    const path = resolve(c.req.query('path') ?? activeWorkspace)
    let stat
    try {
      stat = statSync(path)
    } catch {
      return c.json({ error: 'path not found: ' + path }, 400)
    }
    if (!stat.isDirectory()) return c.json({ error: 'not a directory: ' + path }, 400)
    const dirs: string[] = []
    for (const name of readdirSync(path)) {
      if (name.startsWith('.') || name === 'node_modules') continue
      try {
        if (statSync(join(path, name)).isDirectory()) dirs.push(name)
      } catch {
        // unreadable entry — skip
      }
      if (dirs.length >= 200) break
    }
    dirs.sort()
    const parent = dirname(path)
    return c.json({ path: path, parent: parent === path ? null : parent, dirs: dirs })
  })
  app.get('/openapi.json', (c) => c.json(openApiSpec()))
  app.get('/ui', (c) => c.redirect('/ui/'))
  app.get('/ui/*', (c) => serveUi(new URL(c.req.url).pathname))

  app.post('/session', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { cwd?: string; model?: string; thinkingLevel?: string; permissionMode?: string }
    const session = store.createSession({
      cwd: body.cwd ?? activeWorkspace,
      model: body.model ?? process.env.MATERIN_MODEL ?? 'claude-sonnet-5-5',
    })
    // 环境变量兜底新会话默认值 (Docker/云端部署用)
    const thinking = body.thinkingLevel ?? process.env.MATERIN_THINKING
    if (thinking) store.setThinkingLevel(session.id, normalizeThinking(thinking))
    const mode = body.permissionMode ?? process.env.MATERIN_MODE
    if (mode) store.setPermissionMode(session.id, normalizeMode(mode))
    return c.json(store.getSession(session.id) ?? session, 201)
  })

  app.get('/session', (c) => {
    const projectId = c.req.query('projectId')
    return c.json(store.listSessions({ projectId: projectId }))
  })

  app.get('/session/:id', (c) => {
    const session = store.getSession(c.req.param('id'))
    return session ? c.json(session) : c.json({ error: 'not found' }, 404)
  })

  app.delete('/session/:id', (c) => {
    const deleted = store.deleteSession(c.req.param('id'))
    return deleted ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)
  })

  app.get('/config', (c) => c.json(maskedConfigView()))

  app.post('/config', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      defaultModel?: string
      providers?: Record<string, { apiKey?: string; baseUrl?: string }>
    }
    const current = loadConfig() ?? {}
    const providers: Record<string, { apiKey?: string; baseUrl?: string }> = { ...current.providers }
    for (const [id, entry] of Object.entries(body.providers ?? {})) {
      if (!PROVIDER_PRESETS.some((p) => p.id === id)) continue
      const prev = providers[id] ?? {}
      providers[id] = {
        ...(entry.apiKey ? { apiKey: entry.apiKey } : prev.apiKey ? { apiKey: prev.apiKey } : {}),
        ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : prev.baseUrl ? { baseUrl: prev.baseUrl } : {}),
      }
    }
    const next: MaterinConfig = {
      ...current,
      ...(body.defaultModel ? { defaultModel: body.defaultModel.trim() } : {}),
      providers: providers,
    }
    saveConfig(next)
    applyConfigToEnv(next)
    return c.json(maskedConfigView())
  })

  app.get('/session/:id/messages', (c) => {
    const session = store.getSession(c.req.param('id'))
    if (!session) return c.json({ error: 'not found' }, 404)
    return c.json(store.getMessagesToLeaf(session.id))
  })

  app.get('/search', (c) => {
    const q = c.req.query('q') ?? ''
    const limitRaw = c.req.query('limit')
    const limit = limitRaw ? Number(limitRaw) : undefined
    return c.json(store.search(q, limit))
  })

  app.get('/session/:id/search', (c) => {
    const session = store.getSession(c.req.param('id'))
    if (!session) return c.json({ error: 'not found' }, 404)
    if (!session) return c.json({ error: 'not found' }, 404)
    const q = c.req.query('q') ?? ''
    const limitRaw = c.req.query('limit')
    const limit = limitRaw ? Number(limitRaw) : undefined
    return c.json(store.search(q, limit))
  })

  app.post('/session/:id/branch', async (c) => {
    const { messageId } = (await c.req.json()) as { messageId: string }
    try {
      store.branch(c.req.param('id'), messageId)
      return c.json({ ok: true })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ error: message }, 400)
    }
  })

  app.post('/session/:id/prompt', async (c) => {
    const body = (await c.req.json()) as { text?: string; images?: ImageBlock[] }
    if (!body.text || body.text.trim().length === 0) return c.json({ error: 'text is required' }, 400)
    const sessionId = c.req.param('id')
    const session = store.getSession(sessionId)
    if (!session) return c.json({ error: 'session not found' }, 404)
    if (running.has(sessionId)) return c.json({ error: 'session is already running' }, 409)

    const parsed = await parseInput(body.text, session.cwd ?? process.cwd())
    if (parsed.command) return await handleCommand(c, sessionId, parsed.command)

    const pasted = validateImages(body.images)
    if (typeof pasted === 'string') return c.json({ error: pasted }, 400)
    const images = [...pasted, ...parsed.images]

    const agent = createAgent(sessionId)
    const ctrl = new AbortController()
    running.set(sessionId, ctrl)

    const attachments = parsed.attachments
    const combined = [...attachments, parsed.text.trim()].filter((s) => s.length > 0).join('\n\n')
    const text = combined.length > 0 ? combined : ' '

    void (async () => {
      try {
        for await (const ev of agent.prompt(text, { signal: ctrl.signal, images })) {
          bus.emit(ev)
        }
        await deps.reflect?.(sessionId)
      } catch {
        // agent errors are emitted as agent_error events by the loop itself
      } finally {
        running.delete(sessionId)
      }
    })()

    return c.json({ ok: true }, 202)
  })

  app.post('/extensions/reload', async (c) => {
    if (!deps.reloadExtensions) return c.json({ error: 'extensions not configured' }, 400)
    try {
      await deps.reloadExtensions()
      return c.json({ ok: true })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ error: message }, 500)
    }
  })

  async function handleCommand(c: Context, sessionId: string, command: { name: string; arg?: string }): Promise<Response> {
    const ext = deps.getExtensions?.()
    const extHandler = ext?.commands.get(command.name.slice(1))
    if (extHandler) {
      try {
        const output = await extHandler(command.arg ?? '')
        return c.json({ command: true, output: output })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        return c.json({ command: true, output: 'extension command failed: ' + message, error: message })
      }
    }
    const entry = registry.get(command.name)
    if (!entry) return c.json({ command: true, error: 'unknown command: ' + command.name }, 400)
    return entry.run(c, sessionId, command.arg)
  }

  app.post('/session/:id/abort', (c) => {
    const ctrl = running.get(c.req.param('id'))
    if (!ctrl) return c.json({ ok: false, error: 'not running' })
    ctrl.abort()
    return c.json({ ok: true })
  })

  app.post('/session/:id/compact', async (c) => {
    const sessionId = c.req.param('id')
    const session = store.getSession(sessionId)
    if (!session) return c.json({ error: 'not found' }, 404)
    const model = session.model ?? 'claude-sonnet-5-5'
    try {
      const result = await compact(store, resolveProvider, model, sessionId)
      if (result === null) return c.json({ error: 'nothing to compact' }, 400)
      return c.json(result)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ error: message }, 502)
    }
  })

  app.post('/session/:id/model', async (c) => {
    const sessionId = c.req.param('id')
    if (!store.getSession(sessionId)) return c.json({ error: 'not found' }, 404)
    const body = (await c.req.json().catch(() => ({}))) as { model?: string }
    if (!body.model || body.model.trim().length === 0) return c.json({ error: 'model is required' }, 400)
    const resolved = resolveModel(body.model.trim())
    store.setSessionModel(sessionId, resolved.id)
    const session = store.getSession(sessionId)
    return session ? c.json(session) : c.json({ error: 'not found' }, 404)
  })

  app.post('/session/:id/thinking', async (c) => {
    const sessionId = c.req.param('id')
    const session = store.getSession(sessionId)
    if (!session) return c.json({ error: 'not found' }, 404)
    const body = (await c.req.json().catch(() => ({}))) as { level?: string }
    if (!body.level || body.level.trim().length === 0) return c.json({ error: 'level is required' }, 400)
    const level = normalizeThinking(body.level)
    store.setThinkingLevel(sessionId, level)
    const updated = store.getSession(sessionId)
    return updated ? c.json(updated) : c.json({ error: 'not found' }, 404)
  })

  app.post('/session/:id/mode', async (c) => {
    const sessionId = c.req.param('id')
    if (!store.getSession(sessionId)) return c.json({ error: 'not found' }, 404)
    const body = (await c.req.json().catch(() => ({}))) as { mode?: string }
    if (!body.mode || body.mode.trim().length === 0) return c.json({ error: 'mode is required' }, 400)
    const mode = normalizeMode(body.mode)
    store.setPermissionMode(sessionId, mode)
    const updated = store.getSession(sessionId)
    return updated ? c.json(updated) : c.json({ error: 'not found' }, 404)
  })

  app.get('/session/:id/files', (c) => {
    const session = store.getSession(c.req.param('id'))
    if (!session) return c.json({ error: 'not found' }, 404)
    const q = c.req.query('q') ?? ''
    return c.json({ files: listFiles(session.cwd ?? process.cwd(), q) })
  })

  app.get('/models', (c) => c.json(listAvailableModels()))

  app.post('/session/:id/permission/:callId', async (c) => {
    const sessionId = c.req.param('id')
    if (!store.getSession(sessionId)) return c.json({ error: 'not found' }, 404)
    const callId = c.req.param('callId')
    const body = (await c.req.json().catch(() => ({}))) as { allow?: boolean }
    const resolved = answerPermission(callId, body.allow === true)
    return c.json({ ok: resolved })
  })

  app.get('/event', (c) =>
    streamSSE(c, async (stream) => {
      let open = true
      const unsubscribe = bus.subscribe((event) => {
        if (open) void stream.writeSSE({ data: JSON.stringify(event) })
      })
      stream.onAbort(() => {
        open = false
        unsubscribe()
      })
      while (open) {
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
        await stream.sleep(9_000)
      }
    }),
  )

  return app
}

const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGES_PER_PROMPT = 5

/**
 * Validate clipboard-pasted images from the web client.
 * Returns the cleaned ImageBlock[] or an error message string.
 */
function validateImages(images: unknown): ImageBlock[] | string {
  if (images === undefined) return []
  if (!Array.isArray(images)) return 'images must be an array'
  if (images.length > MAX_IMAGES_PER_PROMPT) return 'too many images (max ' + MAX_IMAGES_PER_PROMPT + ')'
  const cleaned: ImageBlock[] = []
  for (const raw of images) {
    const img = raw as { mimeType?: unknown; data?: unknown }
    if (typeof img?.mimeType !== 'string' || !ALLOWED_IMAGE_MIME.includes(img.mimeType)) {
      return 'invalid image mimeType'
    }
    if (typeof img?.data !== 'string') return 'invalid image data'
    const data = img.data.replace(/\s/g, '')
    if (data.length === 0 || !/^[A-Za-z0-9+/=]+$/.test(data)) return 'invalid image data encoding'
    if (Math.floor(data.length * 0.75) > MAX_IMAGE_BYTES) return 'image too large (max 5MB)'
    cleaned.push({ type: 'image', mimeType: img.mimeType, data: data })
  }
  return cleaned
}

/** Masked config view for the GUI: hasKey flags only — API keys are never returned. */
function maskedConfigView(): { defaultModel: string | null; providers: Record<string, { hasKey: boolean; baseUrl?: string }> } {
  const cfg = loadConfig()
  const providers: Record<string, { hasKey: boolean; baseUrl?: string }> = {}
  for (const preset of PROVIDER_PRESETS) {
    const entry = cfg?.providers?.[preset.id]
    const hasKey =
      Boolean(process.env[preset.apiKeyEnv]) ||
      (preset.id === 'anthropic' && Boolean(process.env.ANTHROPIC_AUTH_TOKEN)) ||
      Boolean(entry?.apiKey)
    providers[preset.id] = {
      hasKey: hasKey,
      ...(entry?.baseUrl ? { baseUrl: entry.baseUrl } : {}),
    }
  }
  return { defaultModel: cfg?.defaultModel ?? process.env.MATERIN_MODEL ?? null, providers: providers }
}

const WEB_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

/** Serve the built web SPA (packages/web/dist). Only a couple of files — no serveStatic needed. */
export function serveUi(path: string): Response {
  // 解析顺序: MATERIN_WEB_ROOT > 二进制旁路 web/ (发布包形态) > 源码仓相对路径 (dev)
  let webRoot = process.env.MATERIN_WEB_ROOT ?? ''
  if (!webRoot) {
    const besideBinary = join(dirname(process.execPath), 'web')
    if (existsSync(join(besideBinary, 'index.html'))) webRoot = besideBinary
  }
  if (!webRoot) webRoot = join(import.meta.dir, '../../web/dist')
  const rel = path.replace(/^\/ui\/?/, '')
  const relFile = rel.length === 0 || rel.endsWith('/') ? 'index.html' : rel
  const base = join(webRoot, relFile)
  if (!base.startsWith(webRoot + '/')) return new Response('not found', { status: 404 })
  const ext = relFile.slice(relFile.lastIndexOf('.'))
  const contentType = WEB_CONTENT_TYPES[ext]
  if (!contentType) return new Response('not found', { status: 404 })
  return new Response(Bun.file(base), { headers: { 'content-type': contentType } })
}
