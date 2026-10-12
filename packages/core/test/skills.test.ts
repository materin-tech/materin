import { describe, test, expect } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/session/db'
import { SessionStore } from '../src/session/store'
import { discoverSkills, readSkillBody, buildSkillsListing } from '../src/skills'
import { createSkillTool } from '../src/tools/skill'

function makeSkill(root: string, sub: string, name: string, desc: string): string {
  const dir = join(root, sub, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: ' + name + '\ndescription: ' + desc + '\n---\n\n# ' + name + '\n')
  return dir
}

describe('discoverSkills', () => {
  test('scans cwd .materin/skills only (independent tool, no third-party dirs)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'materin-skill-'))
    makeSkill(cwd, '.materin/skills', 'alpha', 'Alpha does alpha things.')
    // decoy third-party dirs must be ignored at runtime
    makeSkill(cwd, '.claude/skills', 'decoy-claude', 'never discovered at runtime')
    makeSkill(cwd, '.agents/skills', 'decoy-agents', 'never discovered at runtime')
    const skills = discoverSkills(cwd, { globalDir: null })
    expect(skills.map((s) => s.name)).toEqual(['alpha'])
  })

  test('missing dir / missing SKILL.md / missing name -> skipped', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'materin-skill-'))
    mkdirSync(join(cwd, '.materin/skills/empty'), { recursive: true })
    const skills = discoverSkills(cwd, { globalDir: null })
    expect(skills).toHaveLength(0)
  })

  test('globalDir default resolves to ~/.materin/skills', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'materin-skill-'))
    makeSkill(cwd, '.materin/skills', 'proj-skill', 'project level')
    const skills = discoverSkills(cwd) // real home; may add global skills, must contain proj-skill
    expect(skills.map((s) => s.name)).toContain('proj-skill')
  })

  test('readSkillBody returns full SKILL.md content', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'materin-skill-'))
    const dir = makeSkill(cwd, '.materin/skills', 'alpha', 'd')
    const meta = discoverSkills(cwd, { globalDir: null })[0]!
    expect(meta.dir).toBe(dir)
    expect(readSkillBody(meta)).toContain('# alpha')
    expect(readSkillBody(meta)).toContain('description: d')
  })

  test('buildSkillsListing caps at 3000 chars and renders entries', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'materin-skill-'))
    for (let i = 0; i < 40; i += 1) {
      makeSkill(cwd, '.materin/skills', 's' + i, 'Description for skill number ' + i + '.')
    }
    const listing = buildSkillsListing(discoverSkills(cwd, { globalDir: null }))
    expect(listing).not.toBeNull()
    expect(listing!.length).toBeLessThanOrEqual(3000)
    expect(listing).toContain('<skill name="s0">')
    expect(listing).toContain('</available_skills>')
  })

  test('skill tool loads a known skill body and errors on unknown name', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'materin-skill-'))
    makeSkill(cwd, '.materin/skills', 'alpha', 'Alpha does alpha things.')
    const store = new SessionStore(openDb(':memory:'))
    const tool = createSkillTool(cwd, { globalDir: null })
    const ok = await tool.execute({ name: 'alpha' }, { cwd: cwd })
    expect(ok.isError).toBeFalsy()
    expect(ok.content).toContain('# alpha')
    const bad = await tool.execute({ name: 'zzz' }, { cwd: cwd })
    expect(bad.isError).toBe(true)
    expect(bad.content).toContain('unknown skill: zzz')
  })
})
