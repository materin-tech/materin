import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * 静态规则层 (M2): 向上收集 AGENTS.md / CLAUDE.md.
 * 顺序: 全局 ~/.materin/AGENTS.md 最先, 然后根目录 -> cwd (最近的文件最后出现).
 */

const RULE_FILES = ['AGENTS.md', 'CLAUDE.md']

export function collectRules(cwd: string): string {
  const globalPath = join(homedir(), '.materin', 'AGENTS.md')
  const projectFiles = projectRuleFiles(resolve(cwd))
  const paths = existsSync(globalPath) ? [globalPath, ...projectFiles] : projectFiles

  let out = ''
  for (const path of paths) {
    const content = readFileSafe(path)
    if (content.trim().length === 0) continue
    out += '\n\n# Rules from ' + path + '\n\n' + content
  }
  return out.trim()
}

function projectRuleFiles(cwd: string): string[] {
  const dirs: string[] = []
  let current = cwd
  while (true) {
    dirs.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  dirs.reverse() // root first, nearest (cwd) last

  const found: string[] = []
  for (const dir of dirs) {
    for (const name of RULE_FILES) {
      const path = join(dir, name)
      if (existsSync(path)) found.push(path)
    }
  }
  return found
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}
