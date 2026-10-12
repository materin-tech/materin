/**
 * Workspace indicator + switcher: the header shows the active workspace (short
 * name, full path in the tooltip); the modal offers a visual folder browser
 * (GET /fs/dirs) plus manual path entry; POST /workspace switches the server's
 * active workspace so new sessions use it.
 */
import { el } from './render'
import { api, json } from './api'
import { toast } from './ui'

let modal: HTMLElement | null = null
let label: HTMLElement | null = null
let curPath: HTMLElement | null = null
let pathInput: HTMLInputElement | null = null
let dirList: HTMLElement | null = null
let ws = '/'

/** Fetch the active workspace and wire the header indicator + button. */
export async function initWorkspace(): Promise<void> {
  label = document.getElementById('workspace-label')
  document.getElementById('workspace-btn')?.addEventListener('click', () => openModal())
  try {
    ws = (await api<{ workspace: string }>('/workspace')).workspace
  } catch {
    ws = '/'
  }
  renderLabel()
}

/** Current workspace (fetched at init; the server is the source of truth). */
export function currentWorkspace(): string {
  return ws
}

function shortName(p: string): string {
  if (p === '/') return '/'
  const parts = p.split('/').filter((s) => s.length > 0)
  return parts[parts.length - 1] ?? p
}

function renderLabel(): void {
  if (label === null) return
  label.textContent = shortName(ws)
  label.title = ws
}

function openModal(): void {
  if (modal === null) modal = buildModal()
  curPath!.textContent = '当前: ' + ws
  pathInput!.value = ws
  modal.style.display = 'flex'
  void browse(ws)
}

async function browse(path: string): Promise<void> {
  if (dirList === null || pathInput === null) return
  const target = path.trim().length > 0 ? path.trim() : ws
  try {
    const r = await api<{ path: string; parent: string | null; dirs: string[] }>(
      '/fs/dirs?path=' + encodeURIComponent(target),
    )
    pathInput.value = r.path
    renderDirs(r.path, r.parent, r.dirs)
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e))
  }
}

function renderDirs(path: string, parent: string | null, dirs: string[]): void {
  dirList!.replaceChildren()
  if (parent !== null) {
    const up = el('div', 'ws-dir', '📁 ..')
    up.onclick = () => void browse(parent)
    dirList!.append(up)
  }
  for (const d of dirs) {
    const row = el('div', 'ws-dir', '📁 ' + d)
    row.onclick = () => void browse(join(path, d))
    dirList!.append(row)
  }
  if (dirList!.children.length === 0) dirList!.append(el('div', 'ws-empty', '(无子目录)'))
}

function join(a: string, b: string): string {
  return a === '/' ? '/' + b : a + '/' + b
}

function buildModal(): HTMLElement {
  const panel = el('div', 'cfg-panel')
  pathInput = mkInput('/absolute/path')
  const browseBtn = el('button', 'cfg-btn secondary', '浏览')
  browseBtn.onclick = () => void browse(pathInput!.value)
  const useBtn = el('button', 'cfg-btn', '使用此目录')
  useBtn.onclick = () => void useDir()
  const closeBtn = el('button', 'cfg-btn secondary', '关闭')
  closeBtn.onclick = () => {
    modal!.style.display = 'none'
  }
  const actions = el('div', 'cfg-actions')
  actions.append(useBtn, closeBtn)
  curPath = el('div', 'cfg-status', '当前: ' + ws)
  dirList = el('div', 'ws-dirlist')
  panel.append(curPath, dirList, pathInput, browseBtn, actions)
  const overlay = el('div', 'config-modal')
  overlay.append(panel)
  return overlay
}

async function useDir(): Promise<void> {
  const cwd = pathInput!.value.trim()
  if (cwd.length === 0) {
    toast('请输入绝对路径')
    return
  }
  try {
    const r = await api<{ workspace: string }>('/workspace', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ cwd: cwd }),
    })
    ws = r.workspace
    renderLabel()
    modal!.style.display = 'none'
    toast('工作空间已切换: ' + ws)
  } catch (e) {
    toast('切换失败: ' + (e instanceof Error ? e.message : String(e)))
  }
}

function mkInput(placeholder: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = placeholder
  return input
}
