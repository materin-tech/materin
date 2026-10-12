import { Type } from '@sinclair/typebox'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Tool } from './types'

const WriteParams = Type.Object({
  file_path: Type.String({ description: 'Path to the file (absolute or relative to cwd)' }),
  content: Type.String({ description: 'Full content to write' }),
})

export const writeTool: Tool<typeof WriteParams> = {
  name: 'write',
  description: 'Write content to a file, creating parent directories if needed. Overwrites existing content.',
  parameters: WriteParams,
  async execute(args, ctx) {
    const path = resolve(ctx.cwd, args.file_path)
    try {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, args.content, 'utf-8')
      return {
        content: `Wrote ${args.content.length} chars to ${path}`,
        details: { path, bytes: Buffer.byteLength(args.content) },
      }
    } catch (e) {
      return { content: `write failed: ${e instanceof Error ? e.message : String(e)}`, isError: true }
    }
  },
}

const EditParams = Type.Object({
  file_path: Type.String({ description: 'Path to the file (absolute or relative to cwd)' }),
  old_string: Type.String({ description: 'Exact text to replace' }),
  new_string: Type.String({ description: 'Replacement text' }),
  replace_all: Type.Optional(Type.Boolean({ description: 'Replace every occurrence (default false)' })),
})

export const editTool: Tool<typeof EditParams> = {
  name: 'edit',
  description:
    'Replace an exact string in a file. old_string must match exactly and be unique unless replace_all is set. ' +
    'Read the file before editing.',
  parameters: EditParams,
  async execute(args, ctx) {
    const path = resolve(ctx.cwd, args.file_path)
    let text: string
    try {
      text = await readFile(path, 'utf-8')
    } catch {
      return { content: `Cannot read file: ${path}`, isError: true }
    }

    if (args.old_string === args.new_string) {
      return { content: 'old_string and new_string are identical', isError: true }
    }

    const occurrences = text.split(args.old_string).length - 1
    if (occurrences === 0) {
      return { content: `old_string not found in ${path}. Read the file again to get the exact text.`, isError: true }
    }
    if (occurrences > 1 && !args.replace_all) {
      return {
        content: `old_string appears ${occurrences} times in ${path}. Provide more surrounding context to make it unique, or set replace_all: true.`,
        isError: true,
      }
    }

    const next = args.replace_all
      ? text.split(args.old_string).join(args.new_string)
      : text.replace(args.old_string, args.new_string)
    await writeFile(path, next, 'utf-8')

    return {
      content: `Replaced ${args.replace_all ? occurrences : 1} occurrence(s) in ${path}`,
      details: { path, occurrences: args.replace_all ? occurrences : 1 },
    }
  },
}
