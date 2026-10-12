export function renderEvent(ev: {
  type: string
  delta?: { type: 'text' | 'thinking'; text: string }
  tool?: string
  argsPreview?: string
  isError?: boolean
  preview?: string
  error?: string
}): void {
  switch (ev.type) {
    case 'message_update':
      if (ev.delta?.type === 'text') {
        process.stdout.write(ev.delta.text)
      } else if (ev.delta?.type === 'thinking') {
        process.stdout.write(`\x1b[2m${ev.delta.text}\x1b[0m`)
      }
      break

    case 'tool_execution_start':
      process.stdout.write(`\n\x1b[36m⏺ ${ev.tool}\x1b[0m(\x1b[2m${ev.argsPreview}\x1b[0m)\n`)
      break

    case 'tool_execution_end':
      if (ev.isError) {
        process.stdout.write(`  \x1b[31m⎿ error: ${ev.preview}\x1b[0m\n`)
      } else {
        process.stdout.write(`  \x1b[2m⎿ ${ev.preview || 'done'}\x1b[0m\n`)
      }
      break

    case 'agent_end':
      process.stdout.write('\n')
      break

    case 'agent_error':
      process.stdout.write(`\x1b[31m\nerror: ${ev.error}\x1b[0m\n`)
      break
  }
}
