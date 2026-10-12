import { createInterface, type Interface } from 'node:readline'
import type { ChannelAdapter, InboundMessage, OutboundMessage } from '../types'

/**
 * 本地 console 适配器: stdin 行 -> InboundMessage, 回复写 stdout ([materin] 前缀).
 * 用于无凭据冒烟测试与本地调试.
 */

export class ConsoleAdapter implements ChannelAdapter {
  readonly id = 'console'
  private handler: ((msg: InboundMessage) => Promise<void>) | null = null
  private rl: Interface | null = null

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler
  }

  start(): Promise<void> {
    process.stderr.write('console adapter ready, type messages:\n')
    this.rl = createInterface({ input: process.stdin })
    this.rl.on('line', (line: string) => void this.dispatch(line))
    this.rl.on('close', () => process.exit(0))
    return Promise.resolve()
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }

  async send(_chatId: string, msg: OutboundMessage): Promise<void> {
    process.stdout.write('[materin] ' + msg.text + '\n')
  }

  private async dispatch(line: string): Promise<void> {
    const text = line.trim()
    if (text.length === 0) return
    const handler = this.handler
    if (!handler) return
    const msg: InboundMessage = { channel: 'console', chatId: 'local', userId: 'me', text: text, raw: line }
    await handler(msg)
  }
}
