import type { AgentEvent } from '@materin/core'

/**
 * SSE test client: subscribe to /event before prompting, collect live events.
 */

export interface SseFeed {
  events: AgentEvent[]
  close(): void
}

export async function openSse(base: string): Promise<SseFeed> {
  const events: AgentEvent[] = []
  const controller = new AbortController()
  const pump = (async () => {
    try {
      const res = await fetch(base + '/event', { signal: controller.signal })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx = buffer.indexOf('\n\n')
        while (idx >= 0) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const line = block.split('\n').find((l) => l.startsWith('data: '))
          if (line) {
            try {
              events.push(JSON.parse(line.slice(6)) as AgentEvent)
            } catch {
              // ignore malformed frames
            }
          }
          idx = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // aborted or connection closed — expected on close()
    }
  })()
  void pump
  return {
    events: events,
    close(): void {
      controller.abort()
    },
  }
}
