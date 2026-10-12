import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Skills (M5, agentskills.io 标准): 每个子目录含 SKILL.md 即一个 skill.
 * materin 是独立工具, 运行时只扫描自己的目录 (~/.materin/skills + <cwd>/.materin/skills);
 * 第三方目录 (.claude/.agents/opencode) 只在 `materin init` 一次性迁移时读取.
 */

export interface SkillMeta {
  name: string
  description: string
  dir: string
}

export interface DiscoverSkillsOpts {
  /** override the default global dir (~/.materin/skills); null disables global scan (tests) */
  globalDir?: string | null
  /** extra directories appended after the standard ones */
  extraDirs?: string[]
}

const LISTING_CAP = 3000
const DESC_CAP = 160

export function discoverSkills(cwd: string, opts: DiscoverSkillsOpts = {}): SkillMeta[] {
  const dirs: (string | null)[] = [
    opts.globalDir === undefined ? join(homedir(), '.materin', 'skills') : opts.globalDir,
    join(cwd, '.materin', 'skills'),
  ]
  if (opts.extraDirs) dirs.push(...opts.extraDirs)

  const seen = new Set<string>()
  const out: SkillMeta[] = []
  for (const dir of dirs) {
    if (dir === null || !existsSync(dir)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      continue
    }
    for (const entry of entries) {
      const skillDir = join(dir, entry)
      const skillFile = join(skillDir, 'SKILL.md')
      if (!existsSync(skillFile)) continue
      const meta = parseFrontmatter(readFileSafe(skillFile), skillDir)
      if (meta === null || seen.has(meta.name)) continue
      seen.add(meta.name)
      out.push(meta)
    }
  }
  return out
}

/** Full SKILL.md content (frontmatter included; on-demand progressive disclosure). */
export function readSkillBody(meta: SkillMeta): string {
  return readFileSafe(join(meta.dir, 'SKILL.md'))
}

/** System-prompt listing, capped at LISTING_CAP chars. null when no skills. */
export function buildSkillsListing(skills: SkillMeta[]): string | null {
  if (skills.length === 0) return null
  let out = '<available_skills>'
  for (const skill of skills) {
    const desc = skill.description.length > DESC_CAP ? skill.description.slice(0, DESC_CAP) + '…' : skill.description
    const entry = '\n<skill name="' + skill.name + '">' + desc + '</skill>'
    if (out.length + entry.length + '\n</available_skills>'.length > LISTING_CAP) break
    out += entry
  }
  out += '\n</available_skills>'
  return out.length > '<available_skills>\n</available_skills>'.length ? out : null
}

function parseFrontmatter(content: string, dir: string): SkillMeta | null {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') return null
  let name: string | null = null
  let description = ''
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? ''
    if (line === '---') break
    const m = /^(name|description):\s*(.*)$/.exec(line)
    if (!m) continue
    if (m[1] === 'name') name = m[2]?.trim() ?? ''
    else description = m[2]?.trim() ?? ''
  }
  if (name === null || name.length === 0) return null
  return { name: name, description: description, dir: dir }
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}
