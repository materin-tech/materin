import type { Tool } from './types'
import type { SessionStore } from '../session/store'
import type { MemoryStore } from '../memory'
import { bashTool } from './bash'
import { readTool } from './read'
import { editTool, writeTool } from './fs'
import { sessionSearchTool } from './session-search'
import { memoryTool } from './memory'
import { createSkillTool } from './skill'

export interface ToolDeps {
  store: SessionStore
  memory?: MemoryStore
}

/** M5 内置工具集: read / bash / edit / write / session_search / memory / skill (Pi 式极简). */
export function createDefaultTools(
  deps: {
    store: SessionStore
    memory?: MemoryStore
    enableSkills?: boolean
    cwd?: string
    skillsDirsOverride?: string[]
  },
): Tool[] {
  const list: Tool[] = [
    readTool,
    bashTool,
    editTool,
    writeTool,
    sessionSearchTool(deps.store),
    memoryTool(deps.memory),
  ]
  if (deps.enableSkills !== false) {
    list.push(
      createSkillTool(deps.cwd ?? process.cwd(), {
        globalDir: deps.skillsDirsOverride ? null : undefined,
        extraDirs: deps.skillsDirsOverride,
      }),
    )
  }
  return list
}

export { bashTool, readTool, editTool, writeTool }
export type { Tool, ToolContext, ToolOutput } from './types'
