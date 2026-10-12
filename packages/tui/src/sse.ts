/**
 * SSE client — TUI 是 server 的薄客户端 (server-first 铁律).
 */

export interface SseClient {
  close(): void
}

export function connectSse(
  baseUrl: string,
  onEvent: (data: string) => void,
  onError?: (e: unknown) => void,
): SseClient {
  const ctrl = new AbortController()
  void (async () => {
    try {
      const res = await fetch(`${baseUrl}/event`, { signal: ctrl.signal })
      if (!res.ok || !res.body) {
        onError?.(new Error(`SSE connect failed: ${res.status}`))
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
      if (!ctrl.signal.aborted) onError?.(e)
    }
  })()
  return { close: () => ctrl.abort() }
}
