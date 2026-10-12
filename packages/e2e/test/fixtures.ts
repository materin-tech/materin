import type { Provider, StreamContext, StreamEvent } from '@materin/ai'

/**
 * Reusable scripted provider fixtures for the e2e suite.
 */

/** Turn 1 emits a write tool call, turn 2 answers in text (T4 script). */
export function writeScript(filePath: string): StreamEvent[][] {
  return [
    [
      { type: 'toolcall_start', index: 0, id: 'call_write', name: 'write' },
      { type: 'toolcall_delta', index: 0, delta: JSON.stringify({ file_path: filePath, content: 'e2e content' }) },
      { type: 'toolcall_end', index: 0 },
      { type: 'done', usage: { input: 10, output: 5 }, stopReason: 'toolUse' },
    ],
    [
      { type: 'text_start', index: 0 },
      { type: 'text_delta', index: 0, delta: 'wrote it' },
      { type: 'done', usage: { input: 30, output: 8 }, stopReason: 'stop' },
    ],
  ]
}

/** A hanging stream that rejects only when aborted (T10). */
export function hangingProvider(): Provider {
  return {
    async *stream(ctx: StreamContext): AsyncIterable<StreamEvent> {
      await new Promise<never>((_, reject) => {
        const timer = setInterval(() => {
          if (ctx.signal?.aborted) {
            clearInterval(timer)
            reject(new Error('Request was aborted.'))
          }
        }, 20)
      })
      yield { type: 'done', stopReason: 'stop' } // unreachable
    },
  }
}
