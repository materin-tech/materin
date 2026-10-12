// Example extension: a permission gate that protects .env files (~12 lines).
import type { ExtensionAPI } from '../../packages/core/src/extensions'

export default function (api: ExtensionAPI): void {
  api.interceptToolCall((tool, args) => {
    if (tool !== 'edit' && tool !== 'write') return
    const file = (args as { file_path?: unknown }).file_path
    if (typeof file === 'string' && file.includes('.env')) {
      return { block: true, reason: '.env is protected' }
    }
  })
}
