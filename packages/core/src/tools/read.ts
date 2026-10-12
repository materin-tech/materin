import { Type } from '@sinclair/typebox'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Tool } from './types'

const MAX_FILE_BYTES = 256 * 1024

const ReadParams = Type.Object({
  file_path: Type.String({ description: 'Path to the file (absolute or relative to cwd)' }),
  offset: Type.Optional(Type.Number({ description: '1-based line number to start from' })),
  limit: Type.Optional(Type.Number({ description: 'Max lines to return (default 2000)' })),
})

export const readTool: Tool<typeof ReadParams> = {
  name: 'read',
  description: 'Read a text file, optionally windowed by line offset/limit. Fails on binary or oversized files.',
  parameters: ReadParams,
  async execute(args, ctx) {
    const path = resolve(ctx.cwd, args.file_path)
    const info = await stat(path).catch(() => null)
    if (!info) return { content: `File not found: ${path}`, isError: true }
    if (info.isDirectory()) return { content: `Path is a directory, not a file: ${path}`, isError: true }
    if (info.size > MAX_FILE_BYTES) {
      return {
        content: `File too large (${info.size} bytes, limit ${MAX_FILE_BYTES}). Read with offset/limit or use bash.`,
        isError: true,
      }
    }

    const file = Bun.file(path)
    const text = await file.text().catch(() => null)
    if (text === null) return { content: `Cannot read file as text (binary?): ${path}`, isError: true }

    const lines = text.split('\n')
    const offset = Math.max(1, args.offset ?? 1)
    const limit = args.limit ?? 2000
    const slice = lines.slice(offset - 1, offset - 1 + limit)

    return {
      content: slice.length === 0 ? `(empty range: file has ${lines.length} lines)` : slice.join('\n'),
      details: { path, totalLines: lines.length, returnedLines: slice.length, offset },
    }
  },
}
