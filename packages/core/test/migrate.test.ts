import { describe, test, expect } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateImportSkills } from '../src/migrate'

const SKILL_MD = (name: string): string => '---\nname: ' + name + '\ndescription: d\n---\n\n# ' + name + '\n'

function makeSource(root: string, source: string, name: string): void {
  mkdirSync(join(root, source, name), { recursive: true })
  writeFileSync(join(root, source, name, 'SKILL.md'), SKILL_MD(name))
}

describe('migrateImportSkills', () => {
  test('imports global + project sources, sources untouched', async () => {
    const home = mkdtempSync(join(tmpdir(), 'materin-mig-home-'))
    const project = mkdtempSync(join(tmpdir(), 'materin-mig-proj-'))
    makeSource(home, '.claude/skills', 'web-dev')
    makeSource(home, '.agents/skills', 'go-patterns')
    makeSource(project, '.claude/skills', 'proj-skill')
    // opencode source uses nested config path
    mkdirSync(join(home, '.config/opencode/skills/oc-skill'), { recursive: true })
    writeFileSync(join(home, '.config/opencode/skills/oc-skill/SKILL.md'), SKILL_MD('oc-skill'))

    const result = await migrateImportSkills({ homeDir: home, projectDir: project })
    expect(result.sources).toHaveLength(4)
    expect(result.copied.map((c) => c.name).sort()).toEqual(['go-patterns', 'oc-skill', 'proj-skill', 'web-dev'])
    expect(existsSync(join(home, '.materin/skills/web-dev/SKILL.md'))).toBe(true)
    expect(existsSync(join(home, '.materin/skills/go-patterns/SKILL.md'))).toBe(true)
    expect(existsSync(join(home, '.materin/skills/oc-skill/SKILL.md'))).toBe(true)
    expect(existsSync(join(project, '.materin/skills/proj-skill/SKILL.md'))).toBe(true)
    // sources untouched
    expect(readFileSync(join(home, '.claude/skills/web-dev/SKILL.md'), 'utf-8')).toBe(SKILL_MD('web-dev'))
    expect(existsSync(join(home, '.claude/skills/web-dev/SKILL.md'))).toBe(true)
  })

  test('second run skips existing; force overwrites', async () => {
    const home = mkdtempSync(join(tmpdir(), 'materin-mig-home-'))
    const project = mkdtempSync(join(tmpdir(), 'materin-mig-proj-'))
    const sourceContent = SKILL_MD('web-dev') + 'extra line\n'
    makeSource(home, '.claude/skills', 'web-dev')
    writeFileSync(join(home, '.claude/skills/web-dev/SKILL.md'), sourceContent)

    const first = await migrateImportSkills({ homeDir: home, projectDir: project })
    const second = await migrateImportSkills({ homeDir: home, projectDir: project })
    expect(first.copied.map((c) => c.name)).toEqual(['web-dev'])
    expect(second.skipped.map((s) => s.name)).toEqual(['web-dev'])
    expect(readFileSync(join(home, '.materin/skills/web-dev/SKILL.md'), 'utf-8')).toBe(sourceContent)
    const forced = await migrateImportSkills({ homeDir: home, projectDir: project, force: true })
    expect(forced.copied.map((c) => c.name)).toEqual(['web-dev'])
    expect(readFileSync(join(home, '.materin/skills/web-dev/SKILL.md'), 'utf-8')).toBe(sourceContent)
  })
})
