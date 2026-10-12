/**
 * Shared UI primitives for the Materin web app (no framework):
 * element lookups, system line, toast. Rendering lives in render.ts.
 */
import { el } from './render'

export interface SessionRow {
  id: string
  title: string | null
  cwd: string | null
  createdAt: number
}

export function messagesEl(): HTMLElement {
  return document.getElementById('messages') as HTMLElement
}

export function inputEl(): HTMLTextAreaElement {
  return document.getElementById('input') as HTMLTextAreaElement
}

export function sessionListEl(): HTMLElement {
  return document.getElementById('session-list') as HTMLElement
}

export function modeSelectEl(): HTMLSelectElement {
  return document.getElementById('mode-select') as HTMLSelectElement
}

export function appendSystem(text: string): void {
  const box = messagesEl()
  box.append(el('div', 'system-line', text))
  box.scrollTop = box.scrollHeight
}

export function toast(text: string): void {
  const node = el('div', 'toast', text)
  document.body.append(node)
  setTimeout(() => node.remove(), 2200)
}
