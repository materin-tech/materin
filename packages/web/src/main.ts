/**
 * Materin web SPA entry: wiring + search. Sessions in sessions.ts,
 * composer in composer.ts, @-autocomplete in ac.ts, config editor in
 * config-modal.ts. Rendering in render.ts, SSE in stream.ts.
 */
import { el } from './render'
import { api } from './api'
import { state } from './state'
import { appendSystem } from './ui'
import { loadSessions, openSession, newSession, reloadCurrent } from './sessions'
import { initComposer } from './composer'
import { acActive } from './ac'
import { initConfigModal } from './config-modal'
import { connectEvents } from './stream'

async function runSearch(): Promise<void> {
  const searchInputEl = document.getElementById('search-input') as HTMLInputElement
  const searchResultsEl = document.getElementById('search-results') as HTMLElement
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

function initSearch(): void {
  const searchInputEl = document.getElementById('search-input') as HTMLInputElement
  searchInputEl.onkeydown = (e) => {
    if (e.key === 'Enter') void runSearch()
  }
}

function initModeSelect(): void {
  const select = document.getElementById('mode-select') as HTMLSelectElement
  select.onchange = () => {
    if (state.sessionId === null) return
    void api('/session/' + state.sessionId + '/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: select.value }),
    }).catch((e: unknown) => appendSystem('error: ' + (e instanceof Error ? e.message : String(e))))
  }
}

function boot(): void {
  document.getElementById('new-session')?.addEventListener('click', () => void newSession())
  initSearch()
  initModeSelect()
  initComposer()
  initConfigModal()
  connectEvents({
    isCurrent: (sessionId: string) => sessionId === state.sessionId,
    reload: () => reloadCurrent(),
    system: appendSystem,
  })
  void loadSessions()
}

boot()
