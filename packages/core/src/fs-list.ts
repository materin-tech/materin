import { readdirSync, type Dirent } from 'node:fs'
import { sep } from 'node:path'

/**
 * @ file autocomplete helper: recursively list relative paths under root.
 * Skips node_modules/.git/.materin/dist, depth<=6, scan cap 2000, returns 30.
 */

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.materin'])
const MAX_DEPTH = 6
const MAX_SCANNED = 2000
const MAX_RESULTS = 30

/** Active @token of q: text after the last '@' with no whitespace; whole q if no '@'. */
export function atToken(q: string): string {
  const at = q.lastIndexOf('@')
  if (at < 0) return q.trim().toLowerCase()
  const after = q.slice(at + 1)
  if (/\s/.test(after)) return ''
  return after.toLowerCase()
}

function isMatch(rel: string, token: string): boolean {
  if (token.length === 0) return true
  return rel.toLowerCase().includes(token)
}

/** Recursively walk root and return relative paths matching q's @token. */
export function listFiles(root: string, q: string): string[] {
  const token = atToken(q)
  const results: string[] = []
  let scanned = 0
  walk(root, '')
  return results

  function walk(dir: string, prefix: string): void {
    if (results.length >= MAX_RESULTS || scanned >= MAX_SCANNED) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS || scanned >= MAX_SCANNED) return
      scanned += 1
      const rel = prefix.length === 0 ? entry.name : prefix + sep + entry.name
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        if (rel.split(sep).length > MAX_DEPTH) continue
        walk(dir + sep + entry.name, rel)
      } else if (isMatch(rel, token)) {
        results.push(rel)
      }
    }
  }
}
