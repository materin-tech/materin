/**
 * Provider-neutral message/content types (pi-ai 范式).
 * All types are JSON-serializable so messages can be persisted as-is.
 */

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  /** mime type, e.g. image/png */
  mimeType: string
  /** base64-encoded data */
  data: string
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface ToolCallBlock {
  type: 'toolCall'
  id: string
  name: string
  arguments: unknown
}

export interface ToolResultBlock {
  type: 'toolResult'
  /** matching tool call id */
  id: string
  name: string
  content: TextBlock[]
  isError?: boolean
  /** UI-only payload, never sent to the LLM */
  details?: unknown
}

export type AssistantContentBlock = TextBlock | ThinkingBlock | ToolCallBlock
export type UserContentBlock = TextBlock | ImageBlock
export type ContentBlock = AssistantContentBlock | UserContentBlock | ToolResultBlock

export interface UserMessage {
  role: 'user'
  content: UserContentBlock[]
}

export interface AssistantMessage {
  role: 'assistant'
  content: AssistantContentBlock[]
  provider?: string
  model?: string
  usage?: Usage
  stopReason?: string
}

export interface ToolResultMessage {
  role: 'toolResult'
  content: ToolResultBlock[]
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage

export interface Usage {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

// ---------------------------------------------------------------------------
// Streaming events (pi-ai event model, simplified for M1)
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: 'start' }
  | { type: 'text_start'; index: number }
  | { type: 'text_delta'; index: number; delta: string }
  | { type: 'text_end'; index: number }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'toolcall_start'; index: number; id: string; name: string }
  | { type: 'toolcall_delta'; index: number; delta: string }
  | { type: 'toolcall_end'; index: number }
  | { type: 'done'; usage?: Usage; stopReason?: string }
  | { type: 'error'; error: Error }

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema (from TypeBox) */
  parameters: unknown
}

export interface StreamContext {
  systemPrompt: string
  messages: Message[]
  tools: ToolDefinition[]
  model: string
  maxTokens?: number
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high' | 'xhigh'
  signal?: AbortSignal
}

export interface Provider {
  stream(ctx: StreamContext): AsyncIterable<StreamEvent>
}
