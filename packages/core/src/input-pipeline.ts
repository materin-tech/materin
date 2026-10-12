import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import type { ImageBlock } from '@materin/ai'

/**
 * Input pipeline (M3): parse '@' file references / '!' shell capture / '/' commands.
 * Runs identically for every client (TUI/web/desktop send raw text only).
 */

export interface ParsedInput {
  text: string
  images: ImageBlock[]
  attachments: string[]
  command?: { name: string; arg?: string }
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const MAX_TEXT_FILE_BYTES = 100 * 1024
const MAX_SHELL_OUTPUT_CHARS = 10_000
const SHELL_TIMEOUT_MS = 60_000

export async function parseInput(raw: string, cwd: string): Promise<ParsedInput> {
  if (raw.startsWith('/')) return parseCommand(raw)
  if (raw.startsWith('!')) return parseShell(raw, cwd)
  return parseAtRefs(raw, cwd)
}

function parseCommand(raw: string): ParsedInput {
  const body = raw.slice(1).trim()
  const first = body.split(/\s+/)[0] ?? ''
  const name = '/' + first
  const arg = body.slice(first.length).trim()
  const parsed: ParsedInput = { text: '', images: [], attachments: [] }
  parsed.command = { name: name, arg: arg.length < 1 ? undefined : arg }
  return parsed
}

async function parseShell(raw: string, cwd: string): Promise<ParsedInput> {
  const cmd = raw.slice(1)
  const result = await runShell(cmd, cwd)
  let output = result.output
  if (output.length > MAX_SHELL_OUTPUT_CHARS) {
    output = output.slice(0, MAX_SHELL_OUTPUT_CHARS) + '…[truncated]'
  }
  let attachment = '[Shell output: ' + cmd + ']\n' + output
  if (result.exitCode !== 0) attachment += '\nexit code: ' + result.exitCode
  return { text: '(shell output attached)', images: [], attachments: [attachment] }
}

async function runShell(cmd: string, cwd: string): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn(['bash', '-c', cmd], { cwd: cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const timer = setTimeout(() => proc.kill(), SHELL_TIMEOUT_MS)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    const output = (stdout.trim() + '\n' + stderr.trim()).trim()
    return { output: output, exitCode: exitCode }
  } finally {
    clearTimeout(timer)
  }
}

async function parseAtRefs(raw: string, cwd: string): Promise<ParsedInput> {
  let text = raw
  const images: ImageBlock[] = []
  const attachments: string[] = []
  const matches = [...raw.matchAll(/@([^\s]+)/g)]
  for (const match of matches) {
    const token = '@' + (match[1] ?? '')
    const path = resolve(cwd, match[1] ?? '')
    if (!existsSync(path) || !statSync(path).isFile()) continue
    const ext = extname(path).toLowerCase()
    const mime = IMAGE_MIME[ext]
    if (mime) {
      const buf = await readFile(path)
      images.push({ type: 'image', mimeType: mime, data: buf.toString('base64') })
      text = text.split(token).join('')
      continue
    }
    if (statSync(path).size >= MAX_TEXT_FILE_BYTES) continue
    const content = await readFile(path, 'utf-8')
    attachments.push('[Attached: ' + path + ']\n' + content)
    text = text.split(token).join('')
  }
  return { text: text.trim(), images: images, attachments: attachments }
}
