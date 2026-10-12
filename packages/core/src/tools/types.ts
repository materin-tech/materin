import type { Static, TSchema } from '@sinclair/typebox'

/**
 * Tool contract — content 给模型, details 给 UI (pi 的双通道设计).
 */

export interface ToolContext {
  cwd: string
  signal?: AbortSignal
  /** subagent nesting depth of the session running this tool (loop sets it) */
  subagentDepth?: number
  /** id of the session the tool call belongs to (loop sets it) */
  parentSessionId?: string
}

export interface ToolOutput {
  /** text sent to the LLM as the tool result */
  content: string
  isError?: boolean
  /** UI-only payload, never enters the LLM context */
  details?: unknown
}

export interface Tool<S extends TSchema = TSchema> {
  name: string
  description: string
  parameters: S
  execute(args: Static<S>, ctx: ToolContext): Promise<ToolOutput>
}
