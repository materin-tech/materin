/**
 * Thin fetch-based client for the Materin server (M2 SDK).
 */

export interface SseHandle {
  close(): void
}

export class MaterinClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: init?.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      body: init?.body,
      signal: init?.signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error('Materin API ' + path + ' -> ' + res.status + (detail ? ': ' + detail.slice(0, 300) : ''))
    }
    return (await res.json()) as T
  }

  createSession(opts: { cwd?: string; model?: string } = {}): Promise<unknown> {
    return this.request('/session', { method: 'POST', body: JSON.stringify(opts) })
  }

  listSessions(): Promise<unknown> {
    return this.request('/session')
  }

  getSession(id: string): Promise<unknown> {
    return this.request('/session/' + id)
  }

  getMessages(id: string): Promise<unknown> {
    return this.request('/session/' + id + '/messages')
  }

  /** fire-and-forget: the server answers 202 and streams events over SSE */
  async prompt(id: string, text: string): Promise<void> {
    await this.request('/session/' + id + '/prompt', { method: 'POST', body: JSON.stringify({ text: text }) })
  }

  abort(id: string): Promise<unknown> {
    return this.request('/session/' + id + '/abort', { method: 'POST' })
  }

  setModel(id: string, model: string): Promise<unknown> {
    return this.request('/session/' + id + '/model', { method: 'POST', body: JSON.stringify({ model: model }) })
  }

  compact(id: string): Promise<{ summary: string; tokensBefore: number }> {
    return this.request('/session/' + id + '/compact', { method: 'POST' })
  }

  answerPermission(sessionId: string, callId: string, allow: boolean): Promise<unknown> {
    return this.request('/session/' + sessionId + '/permission/' + callId, {
      method: 'POST',
      body: JSON.stringify({ allow: allow }),
    })
  }

  /** subscribe to the SSE event bus; returns a handle so callers can stop listening */
  waitForEvents(onEvent: (event: unknown) => void, onError?: (e: unknown) => void): SseHandle {
    const ctrl = new AbortController()
    void (async () => {
      try {
        const res = await fetch(this.baseUrl + '/event', { signal: ctrl.signal })
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
          let sep = buf.indexOf('\n\n')
          while (sep >= 0) {
            const block = buf.slice(0, sep)
            buf = buf.slice(sep + 2)
            for (const line of block.split('\n')) {
              if (line.startsWith('data:')) onEvent(JSON.parse(line.slice(5).trim()))
            }
            sep = buf.indexOf('\n\n')
          }
        }
      } catch (e) {
        if (!ctrl.signal.aborted) onError?.(e)
      }
    })()
    return { close: () => ctrl.abort() }
  }
}
