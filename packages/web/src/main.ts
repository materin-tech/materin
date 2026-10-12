/**
 * Materin web SPA entry: sessions, composer with paste-images, search, wiring.
 * Vanilla TS + DOM APIs, no framework. Rendering in render.ts, SSE in stream.ts.
 */
import { el, renderMessages, type UiMessage } from './render'
import { connectEvents } from './stream'

interface SessionRow {
  id: string
  title: string | null
  createdAt: number
}

interface PendingImage {
  mimeType: string
  data: string
}

const messagesEl = document.getElementById('messages') as HTMLElement
const inputEl = document.getElementById('input') as HTMLTextAreaElement
const sessionListEl = document.getElementById('session-list') as HTMLElement
const searchResultsEl = document.getElementById('search-results') as HTMLElement
const searchInputEl = document.getElementById('search-input') as HTMLInputElement
const pendingEl = document.getElementById('pending-images') as HTMLElement
const modeSelectEl = document.getElementById('mode-select') as HTMLSelectElement
const fileAcEl = document.getElementById('file-ac') as HTMLElement

let currentSessionId: string | null = null
let pendingImages: PendingImage[] = []
let pendingFiles: PendingFile[] = []

interface PendingFile {
  name: string
  content: string
}

const MAX_PASTE_FILE_BYTES = 200 * 1024
const TEXT_EXTS = new Set(['.txt', '.md', '.json', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.css', '.html', '.yml', '.yaml', '.toml', '.sh', '.sql', '.xml', '.csv', '.log'])

function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  const dot = file.name.lastIndexOf('.')
  if (dot < 0) return false
  return TEXT_EXTS.has(file.name.slice(dot).toLowerCase())
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(body.error ?? res.statusText)
  return body as T
}

async function loadSessions(): Promise<void> {
  const rows = await api<SessionRow[]>('/session')
  sessionListEl.replaceChildren()
  for (const s of rows) {
    const item = el('div', 'session-item' + (s.id === currentSessionId ? ' active' : ''))
    item.append(
      el('div', undefined, s.title ?? s.id),
      el('div', 'sid', new Date(s.createdAt).toLocaleDateString()),
    )
    item.onclick = () => void openSession(s.id)
    sessionListEl.append(item)
  }
}

async function openSession(id: string): Promise<void> {
  currentSessionId = id
  const [msgs, session] = await Promise.all([
    api<UiMessage[]>('/session/' + id + '/messages'),
    api<SessionRow & { permissionMode?: string }>('/session/' + id),
  ])
  renderMessages(messagesEl, msgs)
  modeSelectEl.value = session.permissionMode ?? 'manual'
  await loadSessions()
}

async function reloadCurrent(): Promise<void> {
  if (currentSessionId === null) return
  const msgs = await api<UiMessage[]>('/session/' + currentSessionId + '/messages')
  renderMessages(messagesEl, msgs)
  await loadSessions()
}

async function newSession(): Promise<void> {  const created = await api<SessionRow>('/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd: '/' }),
  })
  await loadSessions()
  await openSession(created.id)
}

function appendSystem(text: string): void {
  messagesEl.append(el('div', 'system-line', text))
  messagesEl.scrollTop = messagesEl.scrollHeight
}

async function send(): Promise<void> {
  const typed = inputEl.value.trim()
  const attachmentBlocks = pendingFiles.map((f) => '\n\n[Attached file: ' + f.name + ']\n' + f.content).join('')
  if (typed.length === 0 && attachmentBlocks.length === 0) return
  if (currentSessionId === null) return
  inputEl.value = ''
  const images = pendingImages
  pendingImages = []
  pendingFiles = []
  renderPending()
  const text = typed + attachmentBlocks
  try {
    const res = await api<Record<string, unknown>>('/session/' + currentSessionId + '/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, images }),
    })
    if (res['command'] === true) appendSystem('[command] ' + JSON.stringify(res))
  } catch (e) {
    appendSystem('error: ' + (e instanceof Error ? e.message : String(e)))
  }
}

async function runSearch(): Promise<void> {
  const q = searchInputEl.value.trim()
  if (q.length === 0) return
  searchResultsEl.replaceChildren()
  const hits = await api<{ sessionId: string; snippet: string }[]>('/search?q=' + encodeURIComponent(q))
  for (const hit of hits.slice(0, 10)) {
    const hitEl = el('div', 'search-hit')
    hitEl.append(el('div', undefined, hit.sessionId), el('div', 'snippet', hit.snippet))
    hitEl.onclick = () => void openSession(hit.sessionId)
    searchResultsEl.append(hitEl)
  }
}

function renderPending(): void {
  pendingEl.replaceChildren()
  pendingImages.forEach((img, idx) => {
    const chip = el('div', 'chip')
    const thumb = document.createElement('img')
    thumb.src = 'data:' + img.mimeType + ';base64,' + img.data
    const remove = el('button', undefined, '×')
    remove.onclick = () => {
      pendingImages = pendingImages.filter((_, i) => i !== idx)
      renderPending()
    }
    chip.append(thumb, remove)
    pendingEl.append(chip)
  })
  pendingFiles.forEach((f, idx) => {
    const chip = el('div', 'chip file-chip', f.name)
    const remove = el('button', undefined, '×')
    remove.onclick = () => {
      pendingFiles = pendingFiles.filter((_, i) => i !== idx)
      renderPending()
    }
    chip.append(remove)
    pendingEl.append(chip)
  })
}

searchInputEl.onkeydown = (e) => {
  if (e.key === 'Enter') void runSearch()
}

inputEl.onkeydown = (e) => {
  if (acItems.length > 0) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

inputEl.addEventListener('paste', (e) => {
  for (const item of e.clipboardData?.items ?? []) {
    const file = item.getAsFile()
    if (file === null) continue
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result)
        const data = url.slice(url.indexOf(',') + 1)
        pendingImages = [...pendingImages, { mimeType: file.type, data }]
        renderPending()
      }
      reader.readAsDataURL(file)
      continue
    }
    if (!isTextFile(file)) {
      e.preventDefault()
      alert('仅支持文本文件附件')
      continue
    }
    if (file.size > MAX_PASTE_FILE_BYTES) {
      e.preventDefault()
      alert('文件过大 (max 200KB)')
      continue
    }
    e.preventDefault()
    void file.text().then((content) => {
      pendingFiles = [...pendingFiles, { name: file.name, content }]
      renderPending()
    })
  }
})

// ---- 审批模式选择 (header 下拉) ----
modeSelectEl.onchange = () => {
  if (currentSessionId === null) return
  void api('/session/' + currentSessionId + '/mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: modeSelectEl.value }),
  }).catch((e: unknown) => appendSystem('error: ' + (e instanceof Error ? e.message : String(e))))
}

// ---- @ 文件自动补全 ----
const MAX_AC_ITEMS = 8
let acItems: string[] = []
let acIndex = -1

function atTokenOf(text: string): string {
  const at = text.lastIndexOf('@')
  if (at < 0) return ''
  const after = text.slice(at + 1)
  if (/\s/.test(after)) return ''
  return after
}

function closeAc(): void {
  acItems = []
  acIndex = -1
  fileAcEl.style.display = 'none'
  fileAcEl.replaceChildren()
}

function applyAc(active: number): void {
  fileAcEl.replaceChildren()
  acItems.forEach((path, i) => {
    const item = el('div', 'ac-item' + (i === active ? ' active' : ''), path)
    item.onmousedown = (ev) => {
      ev.preventDefault()
      completeAc(path)
    }
    fileAcEl.append(item)
  })
}

function completeAc(path: string): void {
  const text = inputEl.value
  const at = text.lastIndexOf('@')
  if (at >= 0) inputEl.value = text.slice(0, at + 1) + path + ' '
  closeAc()
  inputEl.focus()
}

function refreshAc(): void {
  const token = atTokenOf(inputEl.value.slice(0, inputEl.selectionStart ?? inputEl.value.length))
  if (token.length === 0 || currentSessionId === null) {
    closeAc()
    return
  }
  void api<{ files: string[] }>('/session/' + currentSessionId + '/files?q=' + encodeURIComponent(token))
    .then((res) => {
      acItems = res.files.slice(0, MAX_AC_ITEMS)
      acIndex = -1
      if (acItems.length === 0) {
        closeAc()
        return
      }
      fileAcEl.style.display = 'block'
      applyAc(-1)
    })
    .catch(() => closeAc())
}

inputEl.addEventListener('input', () => refreshAc())

inputEl.addEventListener('keydown', (e) => {
  if (acItems.length === 0) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    acIndex = (acIndex + 1) % acItems.length
    applyAc(acIndex)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    acIndex = acIndex <= 0 ? acItems.length - 1 : acIndex - 1
    applyAc(acIndex)
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    completeAc(acItems[Math.max(acIndex, 0)]!)
  } else if (e.key === 'Escape') {
    closeAc()
  }
})

document.getElementById('new-session')?.addEventListener('click', () => void newSession())

connectEvents({
  isCurrent: (sessionId: string) => sessionId === currentSessionId,
  reload: () => reloadCurrent(),
  system: appendSystem,
})
void loadSessions()
