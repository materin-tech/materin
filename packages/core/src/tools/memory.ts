import { Type } from '@sinclair/typebox'
import type { MemoryOperation, MemoryStore } from '../memory'
import type { Tool } from './types'

/**
 * memory tool (M3 策展记忆层): 把跨会话持久事实写入 MEMORY.md (有界, ~800 token).
 */

const MemoryParams = Type.Object({
  operations: Type.Array(
    Type.Object({
      action: Type.Union([Type.Literal('add'), Type.Literal('replace'), Type.Literal('remove')]),
      find: Type.Optional(Type.String()),
      text: Type.Optional(Type.String()),
    }),
  ),
})

export function memoryTool(memory: MemoryStore | undefined): Tool<typeof MemoryParams> {
  return {
    name: 'memory',
    description:
      'Persist durable user/project facts to MEMORY.md (bounded at ~800 tokens; ' +
      'consolidate when over the limit by removing/merging entries in the same batch).',
    parameters: MemoryParams,
    async execute(args) {
      if (!memory) return { content: 'memory not configured', isError: true }
      const result = await memory.apply(args.operations)
      if (result.ok) return { content: 'Memory updated.' }
      if (typeof result.overBy === 'number') {
        return {
          content:
            'MEMORY.md would exceed the 2200 char limit by ' +
            result.overBy +
            ' chars. Consolidate (remove/merge) entries in the same operations batch.',
          isError: true,
        }
      }
      return { content: result.error ?? 'memory apply failed', isError: true }
    },
  }
}
