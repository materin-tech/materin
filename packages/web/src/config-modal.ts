/**
 * Visual config editor: header button opens a modal to edit provider keys,
 * base URLs and default model. Keys are write-only (server returns hasKey flags).
 */
import { el } from './render'
import { api, json } from './api'
import { toast } from './ui'

interface MaskedConfig {
  defaultModel: string | null
  providers: Record<string, { hasKey: boolean; baseUrl?: string }>
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude (Anthropic)',
  deepseek: 'DeepSeek',
  qwen: 'Qwen 通义 (DashScope)',
  kimi: 'Kimi (Moonshot)',
  glm: '智谱 GLM',
  openai: 'OpenAI',
}

let modal: HTMLElement | null = null
let cfg: MaskedConfig | null = null

export function initConfigModal(): void {
  const btn = document.getElementById('config-btn')
  if (btn === null || modal !== null) return
  modal = buildModal()
  document.body.append(modal)
  btn.addEventListener('click', () => {
    modal!.style.display = 'flex'
    void loadConfig()
  })
}

async function loadConfig(): Promise<void> {
  cfg = await api<MaskedConfig>('/config')
  fillFromConfig()
}

interface CfgControls {
  provider: HTMLSelectElement
  key: HTMLInputElement
  baseUrl: HTMLInputElement
  model: HTMLInputElement
  status: HTMLElement
  panel: HTMLElement
}

let ctl: CfgControls | null = null

function buildModal(): HTMLElement {
  const panel = el('div', 'cfg-panel')
  const provider = document.createElement('select')
  for (const id of Object.keys(PROVIDER_LABELS)) {
    const opt = document.createElement('option')
    opt.value = id
    opt.textContent = PROVIDER_LABELS[id] ?? id
    provider.append(opt)
  }
  const key = mkInput('password', 'sk-...')
  const baseUrl = mkInput('text', 'https://api.example.com (可选)')
  const model = mkInput('text', '默认模型 (留空保持不变)')
  const status = el('div', 'cfg-status')
  provider.onchange = () => fillFromConfig()
  const actions = el('div', 'cfg-actions')
  const saveBtn = el('button', 'cfg-btn', '保存')
  saveBtn.onclick = () => void save()
  const closeBtn = el('button', 'cfg-btn secondary', '关闭')
  closeBtn.onclick = () => {
    modal!.style.display = 'none'
  }
  actions.append(saveBtn, closeBtn)
  panel.append(
    el('div', 'cfg-title', '配置'),
    wrap('Provider', provider),
    status,
    wrap('API Key (写入后不可见)', key),
    wrap('Base URL', baseUrl),
    wrap('默认模型', model),
    actions,
  )
  ctl = { provider: provider, key: key, baseUrl: baseUrl, model: model, status: status, panel: panel }
  const overlay = el('div', 'config-modal')
  overlay.append(panel)
  return overlay
}

function wrap(label: string, node: HTMLElement): HTMLElement {
  const row = el('div', 'cfg-row')
  row.append(el('div', 'cfg-label', label), node)
  return row
}

function mkInput(type: string, placeholder: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = type
  input.placeholder = placeholder
  return input
}

function fillFromConfig(): void {
  if (ctl === null || cfg === null) return
  const id = ctl.provider.value
  const entry = cfg.providers[id]
  ctl.key.value = ''
  ctl.baseUrl.value = entry?.baseUrl ?? ''
  ctl.model.value = cfg.defaultModel ?? ''
  ctl.status.textContent = '状态: ' + (entry?.hasKey ? '已配置 (hasKey: true)' : '未配置')
}

async function save(): Promise<void> {
  if (ctl === null) return
  const providers: Record<string, { apiKey?: string; baseUrl?: string }> = {}
  const entry: { apiKey?: string; baseUrl?: string } = {}
  if (ctl.key.value.trim().length > 0) entry.apiKey = ctl.key.value.trim()
  if (ctl.baseUrl.value.trim().length > 0) entry.baseUrl = ctl.baseUrl.value.trim()
  if (Object.keys(entry).length > 0) providers[ctl.provider.value] = entry
  const body: { providers: Record<string, { apiKey?: string; baseUrl?: string }>; defaultModel?: string } = { providers: providers }
  if (ctl.model.value.trim().length > 0) body.defaultModel = ctl.model.value.trim()
  cfg = await api<MaskedConfig>('/config', { method: 'POST', headers: json, body: JSON.stringify(body) })
  toast('已保存')
  fillFromConfig()
}
