/**
 * Usage view: 📊 Token header button opens a modal showing token stats from
 * GET /usage — period segmented control (今日/7天/30天/全部), model filter,
 * totals, per-model table, per-day bar chart and the last 50 per-call records.
 * DOM builders live in usage-render.ts.
 */
import { el } from './render'
import { api } from './api'
import { fillModelSelect, renderUsage, type UsageSummaryView, type UsageTargets } from './usage-render'

const PERIODS: Array<{ value: string; label: string }> = [
  { value: 'today', label: '今日' },
  { value: '7d', label: '7天' },
  { value: '30d', label: '30天' },
  { value: 'all', label: '全部' },
]

let modal: HTMLElement | null = null
let modelsLoaded = false
let period = 'today'
let model = ''

interface Ctl {
  model: HTMLSelectElement
  targets: UsageTargets
}
let ctl: Ctl | null = null

function segButtons(): HTMLElement {
  const wrap = el('div', 'usage-seg')
  for (const p of PERIODS) {
    const b = el('button', p.value === period ? 'active' : undefined, p.label)
    b.onclick = () => {
      period = p.value
      for (const child of wrap.children) child.className = ''
      b.className = 'active'
      void load()
    }
    wrap.append(b)
  }
  return wrap
}

function buildModal(): HTMLElement {
  const panel = el('div', 'cfg-panel usage-panel')
  const title = el('div', 'cfg-title', 'Token 用量统计')
  ctl = {
    model: document.createElement('select'),
    targets: {
      totals: el('div', 'usage-totals'),
      byModel: el('div'),
      chart: el('div'),
      recent: el('div'),
    },
  }
  const seg = segButtons()
  ctl.model.onchange = () => {
    model = ctl!.model.value
    void load()
  }
  const modelRow = el('div', 'cfg-row')
  modelRow.append(el('div', 'cfg-label', '模型过滤'), ctl.model)
  const closeBtn = el('button', 'cfg-btn secondary', '关闭')
  closeBtn.onclick = () => {
    modal!.style.display = 'none'
  }
  const actions = el('div', 'cfg-actions')
  actions.append(closeBtn)
  panel.append(
    title,
    seg,
    modelRow,
    ctl.targets.totals,
    el('div', 'cfg-label', '按模型'),
    ctl.targets.byModel,
    el('div', 'cfg-label', '按日期 (input+output)'),
    ctl.targets.chart,
    el('div', 'cfg-label', '最近调用 (最近 50 条)'),
    ctl.targets.recent,
    actions,
  )
  const overlay = el('div', 'config-modal')
  overlay.append(panel)
  return overlay
}

async function load(): Promise<void> {
  if (ctl === null) return
  const params = new URLSearchParams({ period: period })
  if (model.length > 0) params.set('model', model)
  const summary = await api<UsageSummaryView>('/usage?' + params.toString())
  renderUsage(ctl.targets, summary)
}

async function loadModels(): Promise<void> {
  if (modelsLoaded || ctl === null) return
  const models = await api<Array<{ id: string }>>('/models')
  fillModelSelect(ctl.model, models)
  modelsLoaded = true
}

export function initUsageView(): void {
  const btn = document.getElementById('usage-btn')
  if (btn === null || modal !== null) return
  modal = buildModal()
  document.body.append(modal)
  btn.addEventListener('click', () => {
    modal!.style.display = 'flex'
    void loadModels()
      .catch(() => {})
      .then(() => load())
  })
}
