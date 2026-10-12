/**
 * Session list, open, create (with working-directory picker) and delete.
 */
import { el, renderMessages, type UiMessage } from './render'
import { api, json } from './api'
import { state } from './state'
import { sessionListEl, modeSelectEl, messagesEl, appendSystem, toast, type SessionRow } from './ui'

interface SessionDetail extends SessionRow {
  permissionMode?: string
}

export async function loadSessions(): Promise<void> {
  const rows = await api<SessionRow[]>('/session')
  const list = sessionListEl()
  list.replaceChildren()
  for (const s of rows) {
    const item = el('div', 'session-item' + (s.id === state.sessionId ? ' active' : ''))
    item.append(
      el('div', undefined, s.title ?? s.id),
      el('div', 'sid', new Date(s.createdAt).toLocaleDateString() + ' · ' + (s.cwd ?? '')),
    )
    const del = el('button', 'session-del', '×')
    del.title = '删除会话'
    del.onclick = (e) => {
      e.stopPropagation()
      void deleteSession(s.id)
    }
    item.append(del)
    item.onclick = () => void openSession(s.id)
    list.append(item)
  }
}

export async function openSession(id: string): Promise<void> {
  state.sessionId = id
  const [msgs, session] = await Promise.all([
    api<UiMessage[]>('/session/' + id + '/messages'),
    api<SessionDetail>('/session/' + id),
  ])
  renderMessages(messagesEl(), msgs)
  modeSelectEl().value = session.permissionMode ?? 'manual'
  await loadSessions()
}

export async function reloadCurrent(): Promise<void> {
  if (state.sessionId === null) return
  const msgs = await api<UiMessage[]>('/session/' + state.sessionId + '/messages')
  renderMessages(messagesEl(), msgs)
  await loadSessions()
}

export async function newSession(): Promise<void> {
  // 一键创建: 直接使用服务器当前工作空间 (切换目录用 ⌂ 工作空间)
  const cwd = await api<{ workspace: string }>('/workspace')
    .then((r) => r.workspace)
    .catch(() => '/')
  const created = await api<SessionRow>('/session', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ cwd }),
  })
  await loadSessions()
  await openSession(created.id)
  toast('已创建会话 ' + created.id)
}

export async function deleteSession(sid: string): Promise<void> {
  if (!window.confirm('删除会话 ' + sid + ' ? 该操作不可恢复。')) return
  try {
    await api('/session/' + sid, { method: 'DELETE' })
    if (state.sessionId === sid) {
      state.sessionId = null
      messagesEl().replaceChildren()
    }
  } catch (e) {
    appendSystem('error: ' + (e instanceof Error ? e.message : String(e)))
  }
  await loadSessions()
}
