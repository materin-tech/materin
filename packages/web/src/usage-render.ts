/**
 * Usage view rendering: pure DOM builders for the token-usage modal — totals
 * stat boxes, per-model table, per-day bar chart, recent per-call list and
 * the model filter select. Split from usage-view.ts to keep files small.
 */
import { el } from './render'

export interface UsageSummaryView {
  totals: { input: number; output: number; cacheRead: number; calls: number }
  byModel: Array<{ model: string; input: number; output: number; cacheRead: number; calls: number }>
  byDay: Array<{ day: string; input: number; output: number; calls: number }>
  recent: Array<{ sessionId: string; model: string; input: number; output: number; at: number }>
}

export interface UsageTargets {
  totals: HTMLElement
  byModel: HTMLElement
  chart: HTMLElement
  recent: HTMLElement
}

const fmt = (n: number): string => n.toLocaleString('en-US')

function hhmm(at: number): string {
  const d = new Date(at)
  const mm = String(d.getMinutes()).padStart(2, '0')
  return String(d.getHours()).padStart(2, '0') + ':' + mm
}

function stat(label: string, value: string): HTMLElement {
  const box = el('div', 'stat')
  box.append(el('b', undefined, value), el('span', undefined, label))
  return box
}

function modelRow(m: UsageSummaryView['byModel'][number]): HTMLTableRowElement {
  const tr = document.createElement('tr')
  tr.innerHTML =
    '<td>' + m.model + '</td><td>' + fmt(m.input) + '</td><td>' + fmt(m.output) +
    '</td><td>' + fmt(m.cacheRead) + '</td><td>' + String(m.calls) + '</td>'
  return tr
}

export function fillModelSelect(select: HTMLSelectElement, models: Array<{ id: string }>): void {
  const keep = select.value
  select.replaceChildren()
  const all = document.createElement('option')
  all.value = ''
  all.textContent = '全部模型'
  select.append(all)
  for (const m of models) {
    const opt = document.createElement('option')
    opt.value = m.id
    opt.textContent = m.id
    select.append(opt)
  }
  select.value = keep
}

export function renderUsage(t: UsageTargets, s: UsageSummaryView): void {
  const totals = s.totals
  t.totals.replaceChildren(
    stat('输入', fmt(totals.input)),
    stat('输出', fmt(totals.output)),
    stat('缓存读', fmt(totals.cacheRead)),
    stat('调用次数', fmt(totals.calls)),
  )

  const table = el('table', 'usage-table')
  table.innerHTML =
    '<thead><tr><th>model</th><th>input</th><th>output</th><th>cache</th><th>calls</th></tr></thead>'
  const tbody = document.createElement('tbody')
  if (s.byModel.length === 0) {
    const tr = document.createElement('tr')
    tr.innerHTML = '<td colspan="5" style="text-align:center;color:var(--dim)">(无记录)</td>'
    tbody.append(tr)
  }
  for (const m of s.byModel) tbody.append(modelRow(m))
  table.append(tbody)
  t.byModel.replaceChildren(table)

  const maxTotal = Math.max(1, ...s.byDay.map((d) => d.input + d.output))
  const chart = el('div', 'usage-chart')
  for (const d of s.byDay) {
    const row = el('div', 'row')
    const track = el('div', 'track')
    const bar = el('div', 'usage-bar')
    bar.style.width = Math.max(2, Math.round(((d.input + d.output) / maxTotal) * 100)) + '%'
    track.append(bar)
    row.append(el('span', 'label', d.day), track, el('span', undefined, fmt(d.input + d.output)))
    chart.append(row)
  }
  if (s.byDay.length === 0) chart.append(el('div', 'ws-empty', '(无记录)'))
  t.chart.replaceChildren(chart)

  const list = el('div', 'usage-recent')
  for (const r of s.recent) {
    list.append(el('div', undefined, hhmm(r.at) + '  ' + r.model + '  in=' + r.input + ' out=' + r.output))
  }
  if (s.recent.length === 0) list.append(el('div', undefined, '(无记录)'))
  t.recent.replaceChildren(list)
}
