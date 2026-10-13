/** Slash-command JSON 响应 → 回放区 system 文本 (output/models/error 优先级). */

import type { TranscriptPart } from './types'

export interface CommandBody {
  output?: string
  models?: Array<{ id: string; label?: string }>
  error?: string
  sessionId?: string
}

export function commandOutput(body: CommandBody): string | null {
  if (body.output) return body.output
  if (Array.isArray(body.models)) {
    return body.models.map((m) => m.id + (m.label ? '  ' + m.label : '')).join('\n')
  }
  if (body.error) return 'error: ' + body.error
  return null
}
