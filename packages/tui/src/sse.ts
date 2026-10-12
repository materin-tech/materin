/**
 * SSE client — TUI 是 server 的薄客户端 (server-first 铁律).
 * SSE 读取在 Worker 线程: Bun 主线程的流式 fetch body 会饿死 stdin.
 * Worker 代码运行时写入临时文件再加载 (不依赖 --compile 的 worker 打包).
 */

export interface SseClient {
  close(): void
}

const WORKER_CODE = [
  "self.onmessage = (e) => {",
  "  const msg = e.data",
  "  if (msg.type === 'start' && msg.url) run(msg.url)",
  "}",
  "async function run(url) {",
  "  try {",
  "    const res = await fetch(url)",
  "    if (!res.ok || !res.body) { postMessage({ type: 'error', error: 'SSE ' + res.status }); return }",
  "    const reader = res.body.getReader()",
  "    const decoder = new TextDecoder()",
  "    let buf = ''",
  "    while (true) {",
  "      const { done, value } = await reader.read()",
  "      if (done) break",
  "      buf += decoder.decode(value, { stream: true })",
  "      let sep",
  "      while ((sep = buf.indexOf(String.fromCharCode(10, 10))) >= 0) {",
  "        const block = buf.slice(0, sep)",
  "        buf = buf.slice(sep + 2)",
  "        for (const line of block.split(String.fromCharCode(10))) {",
  "          if (line.startsWith('data:')) postMessage({ type: 'event', data: line.slice(5).trim() })",
  "        }",
  "      }",
  "    }",
  "  } catch (e) {",
  "    postMessage({ type: 'error', error: String(e) })",
  "  }",
  "}",
].join('\n')

export function connectSse(
  baseUrl: string,
  onEvent: (data: string) => void,
  onError?: (e: unknown) => void,
): SseClient {
  const { writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const workerPath = join(tmpdir(), 'materin-sse-worker-' + process.pid + '.mjs')
  writeFileSync(workerPath, WORKER_CODE)

  let worker: Worker | null = null
  try {
    worker = new Worker('file://' + workerPath, { type: 'module' })
  } catch {
    worker = null
  }

  if (!worker) {
    rmSync(workerPath, { force: true })
    void mainThreadFetch(baseUrl, onEvent, onError)
    return { close: () => {} }
  }

  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as { type: string; data?: string; error?: string }
    if (msg.type === 'event' && typeof msg.data === 'string') onEvent(msg.data)
    else if (msg.type === 'error') onError?.(new Error(msg.error ?? 'worker error'))
  }
  worker.onerror = (e: ErrorEvent) => onError?.(new Error(e.message))
  worker.postMessage({ type: 'start', url: baseUrl + '/event' })
  return {
    close: () => {
      worker?.terminate()
      rmSync(workerPath, { force: true })
    },
  }
}

async function mainThreadFetch(
  baseUrl: string,
  onEvent: (data: string) => void,
  onError?: (e: unknown) => void,
): Promise<void> {
  try {
    const res = await fetch(baseUrl + '/event')
    if (!res.ok || !res.body) {
      onError?.(new Error('SSE connect failed: ' + res.status))
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, sep)
        buf = buf.slice(sep + 2)
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) onEvent(line.slice(5).trim())
        }
      }
    }
  } catch (e) {
    if (!isAbort(e)) onError?.(e)
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
}
