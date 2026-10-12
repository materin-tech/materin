import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { TSchema } from '@sinclair/typebox'
import type { Tool } from './tools/types'

/**
 * Extension 总线 (M5, Pi 范式): Bun 原生 import 加载 TS 文件, 无构建步骤.
 * 一个坏掉的扩展绝不能杀死 agent — 每次加载和每次回调都包 try/catch.
 */

export type ToolBlockDecision = { block: boolean; reason?: string }

export interface ExtensionAPI {
  registerTool<S extends TSchema>(tool: Tool<S>): void
  registerCommand(name: string, handler: (arg: string) => string | Promise<string>): void
  /** observe lifecycle events (match on ev.type) */
  on(event: string, handler: (ev: unknown) => void): void
  /** return {block:true, reason} to deny a tool call */
  interceptToolCall(handler: (tool: string, args: unknown) => ToolBlockDecision | undefined | void): void
  log(msg: string): void
}

export interface LoadedExtensions {
  tools: Tool[]
  commands: Map<string, (arg: string) => string | Promise<string>>
  emit(event: unknown): void
  intercept(tool: string, args: unknown): ToolBlockDecision | null
}

const LOG_PREFIX = '[extensions]'

export async function loadExtensions(dirs: string[]): Promise<LoadedExtensions> {
  const tools: Tool[] = []
  const commands = new Map<string, (arg: string) => string | Promise<string>>()
  const eventHandlers: Array<{ event: string; handler: (ev: unknown) => void }> = []
  const interceptors: Array<(tool: string, args: unknown) => ToolBlockDecision | undefined | void> = []

  const makeApi = (name: string): ExtensionAPI => ({
    registerTool: (tool) => {
      tools.push(tool)
    },
    registerCommand: (cmd, handler) => {
      commands.set(cmd.replace(/^\//, ''), handler)
    },
    on: (event, handler) => {
      eventHandlers.push({ event: event, handler: handler })
    },
    interceptToolCall: (handler) => {
      interceptors.push(handler)
    },
    log: (msg) => console.error('[ext:' + name + '] ' + msg),
  })

  for (const dir of dirs) {
    let files: string[] = []
    try {
      if (!existsSync(dir)) continue
      files = readdirSync(dir)
        .filter((f) => f.endsWith('.ts'))
        .sort()
    } catch (e) {
      console.error(LOG_PREFIX + ' cannot read dir ' + dir + ': ' + message(e))
      continue
    }
    for (const file of files) {
      const name = file.slice(0, -3)
      const api = makeApi(name)
      try {
        const mod = (await import(join(dir, file))) as { default?: unknown }
        const setup = mod.default
        if (typeof setup === 'function') await (setup as (api: ExtensionAPI) => unknown)(api)
      } catch (e) {
        console.error('[ext:' + name + '] load failed: ' + message(e))
      }
    }
  }

  return {
    tools: tools,
    commands: commands,
    emit(event) {
      const type = (event as { type?: unknown }).type
      if (typeof type !== 'string') return
      for (const { event: name, handler } of eventHandlers) {
        if (name !== type) continue
        try {
          handler(event)
        } catch (e) {
          console.error(LOG_PREFIX + ' event handler failed (' + name + '): ' + message(e))
        }
      }
    },
    intercept(tool, args) {
      for (const handler of interceptors) {
        try {
          const decision = handler(tool, args)
          if (decision && decision.block) return decision
        } catch (e) {
          console.error(LOG_PREFIX + ' interceptor failed: ' + message(e))
        }
      }
      return null
    },
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
