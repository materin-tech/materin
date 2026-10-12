import { Type } from '@sinclair/typebox'
import type { ModelInfo } from '@materin/ai'
import type { Tool, ToolContext } from './tools/types'
import { AgentSession } from './agent/loop'
import type { SessionStore } from './session/store'
import type { ResolveProvider } from './agent/compaction'

/**
 * Subagent (M5): task 工具把自包含子任务委托给一个全新的子 agent (child session).
 * 子 agent 与父共享 SessionStore, 血缘记在 session.parent_session_id / source='subagent'.
 */

const TaskParams = Type.Object({
  prompt: Type.String({ description: 'Complete standalone instructions for the subtask' }),
  description: Type.Optional(Type.String({ description: 'Short label for the subtask (UI only)' })),
})

export function createTaskTool(opts: {
  store: SessionStore
  resolveProvider: ResolveProvider
  getModelInfo: (model: string) => ModelInfo
  /** tools available to the child (pass base tools WITHOUT the task tool to avoid self-nesting) */
  childTools: Tool[]
  maxDepth?: number
}): Tool<typeof TaskParams> {
  const maxDepth = opts.maxDepth ?? 1
  return {
    name: 'task',
    description:
      'Delegate a self-contained subtask to a fresh subagent that runs in its own child session ' +
      'and returns only its final answer. Use for exploration, research, or parallelizable chunks of work.',
    parameters: TaskParams,
    async execute(args, ctx: ToolContext) {
      const depth = ctx.subagentDepth ?? 0
      if (depth >= maxDepth) return { content: 'subagent depth limit reached', isError: true }

      const parent = ctx.parentSessionId ? opts.store.getSession(ctx.parentSessionId) : null
      const child = opts.store.createSession({
        cwd: ctx.cwd,
        model: parent?.model ?? 'claude-sonnet-5-5',
        source: 'subagent',
        parentSessionId: ctx.parentSessionId,
      })
      const childAgent = new AgentSession(child.id, {
        store: opts.store,
        resolveProvider: opts.resolveProvider,
        getModelInfo: opts.getModelInfo,
        tools: opts.childTools,
        subagentDepth: depth + 1,
        maxSubagentDepth: maxDepth,
      })

      let finalText = ''
      for await (const ev of childAgent.prompt(args.prompt)) {
        if (ev.type === 'message_update' && ev.delta.type === 'text') finalText += ev.delta.text
      }
      return {
        content: finalText.length > 0 ? finalText : '(subagent produced no text)',
        details: { childSessionId: child.id },
      }
    },
  }
}
