import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * `materin init` (M5): 一次性导入第三方 skill 目录 (.claude/.agents/opencode) 到 materin 自己的
 * skills 目录. 运行时绝不读第三方目录 — 这是迁移命令, 不是运行时兼容.
 */

export interface MigrateEntry {
  name: string
  from: string
}

export interface MigrateResult {
  copied: MigrateEntry[]
  skipped: MigrateEntry[]
  sources: string[]
}

export interface MigrateOpts {
  homeDir?: string
  projectDir?: string
  force?: boolean
}

const GLOBAL_SOURCES: Array<{ root: string; label: string }> = [
  { root: '.claude/skills', label: '~/.claude/skills' },
  { root: '.agents/skills', label: '~/.agents/skills' },
  { root: '.config/opencode/skills', label: '~/.config/opencode/skills' },
]

export async function migrateImportSkills(opts: MigrateOpts = {}): Promise<MigrateResult> {
  const home = opts.homeDir ?? homedir()
  const project = opts.projectDir ?? process.cwd()
  const force = opts.force === true

  const sourceSpecs = [
    ...GLOBAL_SOURCES.map((s) => ({
      dir: join(home, s.root),
      label: s.label,
      target: join(home, '.materin', 'skills'),
    })),
    ...PROJECT_SOURCES.map((s) => ({
      dir: join(project, s.root),
      label: s.label,
      target: join(project, '.materin', 'skills'),
    })),
  ]

  const result: MigrateResult = { copied: [], skipped: [], sources: [] }
  for (const spec of sourceSpecs) {
    if (!existsSync(spec.dir)) continue
    result.sources.push(spec.label)
    let entries: string[] = []
    try {
      entries = readdirSync(spec.dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!existsSync(join(spec.dir, entry, 'SKILL.md')) && !existsSync(join(spec.dir, entry, 'skill.md'))) {
        continue
      }
      const target = join(spec.target, entry)
      if (existsSync(target) && !force) {
        result.skipped.push({ name: entry, from: spec.label })
        continue
      }
      try {
        mkdirSync(spec.target, { recursive: true })
        await cp(join(spec.dir, entry), target, { recursive: true })
        result.copied.push({ name: entry, from: spec.label })
      } catch (e) {
        result.skipped.push({ name: entry, from: spec.label + ' (copy failed: ' + (e instanceof Error ? e.message : String(e)) + ')' })
      }
    }
  }
  return result
}

const PROJECT_SOURCES: Array<{ root: string; label: string }> = [
  { root: '.claude/skills', label: '<cwd>/.claude/skills' },
  { root: '.agents/skills', label: '<cwd>/.agents/skills' },
]
