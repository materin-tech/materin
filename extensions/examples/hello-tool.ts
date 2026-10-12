// Example extension: register a tiny custom tool in <20 lines.
// Drop in ~/.materin/extensions/ (or <project>/.materin/extensions/ + trust.json).
import { Type } from '../../packages/core/src/index'
import type { ExtensionAPI } from '../../packages/core/src/extensions'

export default function (api: ExtensionAPI): void {
  api.registerTool({
    name: 'hello',
    description: 'Greet someone by name.',
    parameters: Type.Object({ name: Type.String({ description: 'Who to greet' }) }),
    async execute(args) {
      return { content: 'Hello, ' + args.name }
    },
  })
}
