/**
 * 主线程 HTTP client: 所有 TUI fetch 都在 Worker 线程执行 (Bun runtime bug —
 * 主线程在 raw stdin 开始后 fetch 会让 Ink useInput 按键投递失效).
 *
 * - id 关联并发请求; 每请求 60s 超时; onerror 拒绝所有 pending.
 * - Worker 创建失败 → 降级为主线程 fetch (一次性 console 警告, 应用仍可用).
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, writeFileSync } from 'node:fs'
import { WORKER_CODE } from './http-worker'

const REQUEST_TIMEOUT_MS = 60_000

let warned = false

function warnFallback(reason: string): void {
  if (warned) return
  warned = true
  console.warn('[materin] worker http unavailable (' + reason + '), falling back to main-thread fetch')
}

export interface WorkerHttp {
  request<T>(method: string, path: string, body?: unknown): Promise<T>
  close(): void
}

interface WorkerRequest {
  type: 'request'
  id: number
  method: string
  path: string
  baseUrl: string
  body?: unknown
}

interface WorkerResponse {
  type: 'response'
  id: number
  ok: boolean
  status: number
  json?: unknown
  error?: string
}

interface Pending {
  method: string
  path: string
  resolve(v: unknown): void
  reject(e: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface MiniWorker {
  onmessage: ((ev: { data: WorkerResponse }) => void) | null
  onerror: ((err: unknown) => void) | null
  postMessage(msg: WorkerRequest): void
  terminate(): void
}

function settle(pending: Map<number, Pending>, res: WorkerResponse): void {
  const p = pending.get(res.id)
  if (p === undefined) return
  clearTimeout(p.timer)
  pending.delete(res.id)
  if (res.ok) p.resolve(res.json)
  else p.reject(new Error(res.error ?? 'API ' + p.method + ' ' + p.path + ' -> ' + String(res.status)))
}

function failAll(pending: Map<number, Pending>, err: Error): void {
  for (const p of pending.values()) {
    clearTimeout(p.timer)
    p.reject(err)
  }
  pending.clear()
}

/** Worker 不可用时的降级实现 (bug 复现, 但应用仍可用). */
function fallbackRequest<T>(baseUrl: string, method: string, path: string, body?: unknown): Promise<T> {
  return (async () => {
    const res = await fetch(baseUrl + path, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error('API ' + method + ' ' + path + ' -> ' + String(res.status))
    return (await res.json()) as T
  })()
}

export function createWorkerHttp(baseUrl: string): WorkerHttp {
  const pending = new Map<number, Pending>()
  let nextId = 1
  let worker: MiniWorker | null = null
  let file = ''
  try {
    file = join(tmpdir(), 'materin-http-' + process.pid + '.mjs')
    writeFileSync(file, WORKER_CODE)
    const Ctor = Worker as unknown as new (url: string, opts: { type: string }) => MiniWorker
    worker = new Ctor('file://' + file, { type: 'module' })
    worker.onmessage = (ev) => settle(pending, ev.data)
    worker.onerror = (err) => {
      failAll(pending, new Error('http worker error: ' + String(err)))
    }
  } catch (e) {
    warnFallback(String(e))
    worker = null
  }
  // process.exit() 会跑 'exit' 监听: 兜底清理临时 worker 文件 (React unmount 可能被 exit 竞态跳过)
  const tmpFile = file
  process.once('exit', () => {
    try {
      rmSync(tmpFile)
    } catch {}
  })

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (worker === null) return fallbackRequest<T>(baseUrl, method, path, body)
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('API ' + method + ' ' + path + ' timeout'))
      }, REQUEST_TIMEOUT_MS)
      pending.set(id, { method: method, path: path, resolve: resolve, reject: reject, timer: timer })
      worker!.postMessage({ type: 'request', id: id, method: method, path: path, baseUrl: baseUrl, body: body })
    })
  }

  function close(): void {
    if (worker !== null) worker.terminate()
    worker = null
    if (file !== '') {
      try {
        rmSync(file)
      } catch {}
    }
    failAll(pending, new Error('http client closed'))
  }

  return { request: request, close: close }
}
