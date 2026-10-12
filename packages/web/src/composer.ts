/**
 * Composer: send prompt, paste images/files chips, send on Enter.
 */
import { el } from './render'
import { api, json } from './api'
import { state } from './state'
import { inputEl, messagesEl, appendSystem } from './ui'
import { acActive } from './ac'

interface PendingImage {
  mimeType: string
  data: string
}

interface PendingFile {
  name: string
  content: string
}

const MAX_PASTE_FILE_BYTES = 200 * 1024
const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs',
  '.css', '.html', '.yml', '.yaml', '.toml', '.sh', '.sql', '.xml', '.csv', '.log',
])

function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  const dot = file.name.lastIndexOf('.')
  if (dot < 0) return false
  return TEXT_EXTS.has(file.name.slice(dot).toLowerCase())
}

function renderPending(): void {
  const pendingEl = document.getElementById('pending-images') as HTMLElement
  pendingEl.replaceChildren()
  pendingImages.forEach((img, idx) => {
    const chip = el('div', 'chip')
    const thumb = document.createElement('img')
    thumb.src = 'data:' + img.mimeType + ';base64,' + img.data
    const remove = el('button', undefined, String.fromCharCode(215))
    remove.onclick = () => {
      pendingImages = pendingImages.filter((_, i) => i !== idx)
      renderPending()
    }
    chip.append(thumb, remove)
    pendingEl.append(chip)
  })
  pendingFiles.forEach((f, idx) => {
    const chip = el('div', 'chip file-chip', f.name)
    const remove = el('button', undefined, String.fromCharCode(215))
    remove.onclick = () => {
      pendingFiles = pendingFiles.filter((_, i) => i !== idx)
      renderPending()
    }
    chip.append(remove)
    pendingEl.append(chip)
  })
}

let pendingImages: PendingImage[] = []
let pendingFiles: PendingFile[] = []

async function send(): Promise<void> {
  const input = inputEl()
  const typed = input.value.trim()
  const attachmentBlocks = pendingFiles
    .map((f) => '\n\n[Attached file: ' + f.name + ']\n' + f.content)
    .join('')
  if (typed.length === 0 && attachmentBlocks.length === 0) return
  if (state.sessionId === null) return
  input.value = ''
  const images = pendingImages
  pendingImages = []
  pendingFiles = []
  renderPending()
  const text = typed + attachmentBlocks
  try {
    const res = await api<Record<string, unknown>>('/session/' + state.sessionId + '/prompt', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ text: text, images: images }),
    })
    if (res['command'] === true) appendSystem('[command] ' + JSON.stringify(res))
  } catch (e) {
    appendSystem('error: ' + (e instanceof Error ? e.message : String(e)))
  }
}

export function initComposer(): void {
  const input = inputEl()
  input.onkeydown = (e) => {
    if (acActive()) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  input.addEventListener('paste', (e) => {
    for (const item of e.clipboardData?.items ?? []) {
      const file = item.getAsFile()
      if (file === null) continue
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const reader = new FileReader()
        reader.onload = () => {
          const url = String(reader.result)
          const data = url.slice(url.indexOf(',') + 1)
          pendingImages = [...pendingImages, { mimeType: file.type, data: data }]
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
        pendingFiles = [...pendingFiles, { name: file.name, content: content }]
        renderPending()
      })
    }
  })
}
