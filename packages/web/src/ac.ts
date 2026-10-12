/**
 * @-file autocomplete popup for the composer (files API backed).
 */
import { el } from './render'
import { api } from './api'
import { state } from './state'
import { inputEl } from './ui'

const MAX_AC_ITEMS = 8
const fileAcEl = document.getElementById('file-ac') as HTMLElement

let acItems: string[] = []
let acIndex = -1

export function acActive(): boolean {
  return acItems.length > 0
}

/** 无 '@' → null; '@' 后空 token → '' (CC 对齐: 打 @ 立即列出文件); 否则返回 token. */
function atTokenOf(text: string): string | null {
  const at = text.lastIndexOf('@')
  if (at < 0) return null
  const after = text.slice(at + 1)
  if (/\s/.test(after)) return null
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
  // 方向键移动高亮时, 列表滚动跟随高亮项
  const activeEl = fileAcEl.children[active] as HTMLElement | undefined
  activeEl?.scrollIntoView({ block: 'nearest' })
}

function completeAc(path: string): void {
  const input = inputEl()
  const text = input.value
  const at = text.lastIndexOf('@')
  if (at >= 0) input.value = text.slice(0, at + 1) + path + ' '
  closeAc()
  input.focus()
}

function refreshAc(): void {
  const input = inputEl()
  const token = atTokenOf(input.value.slice(0, input.selectionStart ?? input.value.length))
  if (token === null || state.sessionId === null) {
    closeAc()
    return
  }
  void api<{ files: string[] }>('/session/' + state.sessionId + '/files?q=' + encodeURIComponent(token))
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

inputEl().addEventListener('input', () => refreshAc())

inputEl().addEventListener('keydown', (e) => {
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
