/**
 * 版本同步: package.json (唯一事实源) -> packages/core/src/version.ts
 * 由 compile 脚本在构建前自动执行。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string }
const content = `/**
 * 编译时由 scripts/sync-version.ts 生成 — 不要手改。
 * 唯一事实源: 根 package.json 的 version 字段。
 */
export const VERSION = '${pkg.version}'
`
writeFileSync(new URL('../packages/core/src/version.ts', import.meta.url), content)
console.log('synced version: ' + pkg.version)
