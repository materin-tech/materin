/** index.ts (纯 .ts) 与 Ink App 之间的桥: 在这里写 JSX 并启动 render. */

import { render } from 'ink'
import { App } from '../ink-app'
import type { AppProps } from './types'

export interface InkHandle {
  waitUntilExit(): Promise<void>
  unmount(): void
}

export function renderApp(props: AppProps): InkHandle {
  const instance = render(<App {...props}
      version={props.version} />, { exitOnCtrlC: false })
  return instance
}
