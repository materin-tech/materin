import { Type } from '@sinclair/typebox'
import { discoverSkills, readSkillBody, type SkillMeta } from '../skills'
import type { Tool } from './types'

/**
 * skill tool (M5): 按需加载一个 skill 的完整指令 (progressive disclosure).
 * 技能清单由 loop 注入系统上下文; 工具只负责按名字取正文.
 */

const SkillParams = Type.Object({
  name: Type.String({ description: 'Skill name from the available_skills listing' }),
})

export function createSkillTool(
  cwd: string,
  opts: { globalDir?: string | null; extraDirs?: string[] } = {},
): Tool<typeof SkillParams> {
  let cache: SkillMeta[] | null = null
  return {
    name: 'skill',
    description:
      "Load the full instructions of a named skill (listed in <available_skills>). " +
      'Use before performing the task the skill covers.',
    parameters: SkillParams,
    async execute(args) {
      if (cache === null) cache = discoverSkills(cwd, opts)
      const meta = cache.find((s) => s.name === args.name)
      if (!meta) {
        const names = cache.map((s) => s.name).join(', ')
        return {
          content:
            'unknown skill: ' + args.name + (names.length > 0 ? ' (available: ' + names + ')' : ' (no skills discovered)'),
          isError: true,
        }
      }
      return { content: readSkillBody(meta) }
    },
  }
}
