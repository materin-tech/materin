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
import { initComposerResize } from './composer-resize'
import { acActive } from './ac'
import { initConfigModal, openConfigModal, type MaskedConfig } from './config-modal'
import { initWorkspace } from './workspace'
import { connectEvents } from './stream'

const ONBOARDING_TITLE = '欢迎使用 materin — 请先配置模型 provider'

/** Unconfigured-model hint chip: visible until any provider has a key. */
function initUnconfiguredChip(): void {
  const chip = document.getElementById('unconfigured-chip')
  if (chip === null) return
  chip.addEventListener('click', () => openConfigModal())
  document.addEventListener('materin:config-saved', (e) => {
    const cfg = (e as CustomEvent).detail as MaskedConfig | undefined
    const hasKey = cfg !== undefined && Object.values(cfg.providers).some((p) => p.hasKey)
    chip.style.display = hasKey ? 'none' : 'inline-block'
  })
}

/** Onboarding: with no provider key, auto-open the config modal once. */
async function initOnboarding(): Promise<void> {
  try {
    const cfg = await api<MaskedConfig>('/config')
    const hasKey = Object.values(cfg.providers).some((p) => p.hasKey)
    const chip = document.getElementById('unconfigured-chip')
    if (chip !== null) chip.style.display = hasKey ? 'none' : 'inline-block'
    if (!hasKey) openConfigModal(ONBOARDING_TITLE)
  } catch {
    // config endpoint unavailable — skip onboarding silently
  }
}

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
  initComposerResize()
  initConfigModal()
  initUnconfiguredChip()
  void initWorkspace()
  connectEvents({
    isCurrent: (sessionId: string) => sessionId === state.sessionId,
    reload: () => reloadCurrent(),
    system: appendSystem,
  })
  void loadSessions()
  void initOnboarding()
}

boot()
