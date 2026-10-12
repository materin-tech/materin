/**
 * Composer 拖拽调高 — 拖上边缘手柄: 上拖增高, 下拖降低.
 * 高度记忆在 localStorage; 替代浏览器右下角原生 resize 手柄.
 */

const MIN_H = 44
const MAX_RATIO = 0.6

export function initComposerResize(): void {
  const composer = document.getElementById('composer')
  const ta = document.getElementById('input') as HTMLTextAreaElement | null
  if (!composer || !ta) return

  const handle = document.createElement('div')
  handle.id = 'resize-handle'
  composer.prepend(handle)

  const saved = Number(localStorage.getItem('materin.composer-h'))
  if (saved >= MIN_H) ta.style.height = String(saved) + 'px'

  let startY = 0
  let startH = 0

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault()
    startY = e.clientY
    startH = ta.offsetHeight
    const onMove = (ev: MouseEvent): void => {
      const h = Math.min(Math.max(startH + (startY - ev.clientY), MIN_H), Math.round(window.innerHeight * MAX_RATIO))
      ta.style.height = String(h) + 'px'
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      localStorage.setItem('materin.composer-h', String(ta.offsetHeight))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}
