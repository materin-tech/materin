/** Ink TUI shared types: transcript items + live-stream state. */

/** Static 回放区单项 — 只追加, 渲染后不再变 (Ink Static 语义). */
export type TranscriptItem =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant-text'; text: string }
  | { id: number; kind: 'thinking'; text: string }
  | { id: number; kind: 'tool'; name: string; args: string }
  | { id: number; kind: 'tool-result'; text: string; isError: boolean }
  | { id: number; kind: 'mode'; text: string }
  | { id: number; kind: 'system'; text: string }
  | { id: number; kind: 'logo'; version: string }

/** 去掉 id 的可分发 Omit (对联合类型逐成员生效). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type TranscriptPart = DistributiveOmit<TranscriptItem, 'id'>

/** 运行中位于 live 区的流式内容 (回合/块完成后移入 Static). */
export interface LiveStream {
  kind: 'thinking' | 'text'
  text: string
}

/** 运行中最近一次工具调用 (spinner 下方 dim 回显). */
export interface LastTool {
  name: string
  args: string
  /** 工具执行结果预览 (toolResult 到达时填充, live 区显示) */
  result?: string
}

export interface AppProps {
  base: string
  sessionId: string
  initialMode: string
  model: string
  /** 启动横幅 (作为首条 system 项进入回放区). */
  banner: string
  version?: string
  onExit(): void
}
