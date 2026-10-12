/**
 * SSE streaming for the Materin web UI: live text bubbles, tool lines,
 * permission asks. Owns the EventSource connection and live-bubble state.
 */
import { el, renderRichText } from './render'

export interface StreamDeps {
  isCurrent(sessionId: string): boolean
  reload(): Promise<void>
  system(text: string): void
}

export interface AgentEv {
  type: string
  sessionId?: string
  delta?: { type: string; text: string }
  tool?: string
  argsPreview?: string
  preview?: string
  callId?: string
  args?: unknown
  error?: string
}

const TOOL_RESULT_PREVIEW_CHARS = 200

export function connectEvents(deps: StreamDeps): void {
  const messagesEl = document.getElementById('messages') as HTMLElement
  let live: { bubble: HTMLElement; text: string } | null = null

  function liveBubble(): HTMLElement {
    if (live === null) {
      const bubble = el('div', 'bubble')
      const wrap = el('div', 'msg assistant')
      wrap.append(bubble)
      messagesEl.append(wrap)
      live = { bubble, text: '' }
    }
    return live.bubble
  }

  function appendToolLine(text: string): void {
    messagesEl.append(el('div', 'tool-result', text))
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  function handleEvent(ev: AgentEv): void {
    if (ev.sessionId !== undefined && !deps.isCurrent(ev.sessionId)) return
    switch (ev.type) {
      case 'message_update':
        if (ev.delta?.type !== 'text') return
        if (live === null) live = { bubble: liveBubble(), text: '' }
        live.text += ev.delta.text
        live.bubble.replaceChildren(renderRichText(live.text))
        messagesEl.scrollTop = messagesEl.scrollHeight
        return
      case 'tool_execution_start':
        appendToolLine('⏺ ' + (ev.tool ?? '?') + '(' + (ev.argsPreview ?? '') + ')')
        return
      case 'tool_execution_end':
        appendToolLine('⎿ ' + (ev.preview ?? '').slice(0, TOOL_RESULT_PREVIEW_CHARS))
        return
      case 'agent_end':
      case 'agent_error':
        live = null
        void deps.reload()
        if (ev.type === 'agent_error') deps.system('error: ' + (ev.error ?? 'unknown'))
        return
      case 'permission_ask':
        void askPermission(ev)
        return
    }
  }

  async function askPermission(ev: AgentEv): Promise<void> {
    const allow = confirm('Allow tool "' + (ev.tool ?? '?') + '"?\n' + JSON.stringify(ev.args ?? {}).slice(0, 300))
    await fetch('/session/' + ev.sessionId + '/permission/' + ev.callId, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ allow }),
    }
    )
  }

  const es = new EventSource('/event')
  es.onmessage = (e) => handleEvent(JSON.parse(String(e.data)) as AgentEv)
}
