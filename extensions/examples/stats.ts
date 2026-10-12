// Example extension: observe lifecycle events (agent_end -> log).
import type { ExtensionAPI } from '../../packages/core/src/extensions'

export default function (api: ExtensionAPI): void {
  api.on('agent_end', () => api.log('turn ended'))
}
