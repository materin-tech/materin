import { Type } from '@sinclair/typebox'
import type { Tool } from './types'

const MAX_OUTPUT_CHARS = 30_000
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000

const BashParams = Type.Object({
  command: Type.String({ description: 'The bash command to execute' }),
  timeout: Type.Optional(
    Type.Number({ description: 'Timeout in milliseconds (default 120000, max 600000)' }),
  ),
})

export const bashTool: Tool<typeof BashParams> = {
  name: 'bash',
  description:
    'Execute a bash command and return content+details 双通道: ' +
    'returns stdout/stderr, 30k char head+tail truncation, exit code.',
  parameters: BashParams,
  async execute(args, ctx) {
    const timeoutMs = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    const proc = Bun.spawn(['bash', '-c', args.command], {
      cwd: ctx.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    })

    const timer = setTimeout(() => proc.kill(), timeoutMs)
    let stdout = ''
    let stderr = ''
    let exitCode = 0
    try {
      ;[stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
    } finally {
      clearTimeout(timer)
    }

    const isError = exitCode !== 0
    const parts: string[] = []
    if (stdout.trim()) parts.push(stdout.trim())
    if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`)
    parts.push(`exit code: ${exitCode}`)
    let content = parts.join('\n')
    const details = { command: args.command, exitCode, stdoutChars: stdout.length, stderrChars: stderr.length }

    if (content.length > MAX_OUTPUT_CHARS) {
      const head = content.slice(0, MAX_OUTPUT_CHARS / 2)
      const tail = content.slice(-MAX_OUTPUT_CHARS / 2)
      content = `${head}\n...[output truncated, ${content.length} chars total]...\n${tail}`
    }

    return { content, isError, details }
  },
}
