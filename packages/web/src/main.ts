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

let currentSessionId: string | null = null
let pendingImages: PendingImage[] = []

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
  const msgs = await api<UiMessage[]>('/session/' + id + '/messages')
  renderMessages(messagesEl, msgs)
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
  const text = inputEl.value.trim()
  if (text.length === 0 || currentSessionId === null) return
  inputEl.value = ''
  const images = pendingImages
  pendingImages = []
  renderPending()
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
}

searchInputEl.onkeydown = (e) => {
  if (e.key === 'Enter') void runSearch()
}

inputEl.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

inputEl.addEventListener('paste', (e) => {
  for (const item of e.clipboardData?.items ?? []) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file === null) continue
    e.preventDefault()
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      const data = url.slice(url.indexOf(',') + 1)
      pendingImages = [...pendingImages, { mimeType: file.type, data }]
      renderPending()
    }
    reader.readAsDataURL(file)
  }
})

document.getElementById('new-session')?.addEventListener('click', () => void newSession())

connectEvents({
  isCurrent: (sessionId: string) => sessionId === currentSessionId,
  reload: () => reloadCurrent(),
  system: appendSystem,
})
void loadSessions()
