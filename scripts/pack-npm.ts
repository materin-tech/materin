/**
 * npm 分发打包 (esbuild 模式):
 *   materin              — 主包: bin shims (纯 node, 无依赖) + optionalDependencies
 *   materin-<platform>   — 平台包: 编译好的单二进制
 * 用户 npm i -g materin 后无需安装 Bun。
 * 产物: release/<ver>/npm/*.tgz
 */
import { $ } from 'bun'
import { mkdirSync, cpSync, rmSync, writeFileSync, chmodSync, existsSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = '0.1.0'
const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'release', 'v' + VERSION, 'npm')
const TMP = join(ROOT, '.npm-tmp')
const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const
const BINS = ['materin', 'materin-server', 'materin-gateway'] as const

function shim(name: string): string {
  return `#!/usr/bin/env node
const { spawnSync } = require('child_process')
const platform = process.platform + '-' + process.arch
let bin
try {
  bin = require.resolve('materin-' + platform + '/bin/${name}')
} catch {
  console.error('materin: 平台 ' + platform + ' 的二进制未随包安装 (optionalDependencies 被跳过?)')
  console.error('请从 GitHub Releases 下载, 或安装 materin-' + platform)
  process.exit(1)
}
const r = spawnSync(bin, process.argv.slice(2), { stdio: 'inherit' })
process.exit(r.status ?? 1)
`
}

function mainPkg(): string {
  return JSON.stringify(
    {
      name: 'materin',
      version: VERSION,
      description: 'Self-hosted AI coding agent: TUI/CLI + Web + Feishu/DingTalk/WeCom gateway',
      license: 'MIT',
      keywords: ['ai', 'coding-agent', 'cli', 'claude-code-alternative'],
      bin: {
        materin: 'bin/materin.js',
        'materin-server': 'bin/materin-server.js',
        'materin-gateway': 'bin/materin-gateway.js',
      },
      engines: { node: '>=18' },
      files: ['bin/'],
      optionalDependencies: Object.fromEntries(PLATFORMS.map((p) => ['materin-' + p, VERSION])),
    },
    null,
    2,
  )
}

function platformPkg(platform: string): string {
  const [os, cpu] = platform.split('-')
  return JSON.stringify({ name: 'materin-' + platform, version: VERSION, license: 'MIT', os: [os], cpu: [cpu], files: ['bin/'] }, null, 2)
}

async function main(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  mkdirSync(OUT, { recursive: true })

  // 1. 编译当前平台二进制 (其余平台需在对应机器/CI 上出包)
  const current = process.platform + '-' + process.arch
  console.log('compiling binaries for ' + current + ' ...')
  await $`bun run scripts/sync-version.ts`.quiet()
  for (const [cmd, out] of [
    ['compile', 'materin'],
    ['compile:server', 'materin-server'],
    ['compile:gateway', 'materin-gateway'],
  ] as const) {
    await $`bun run ${cmd}`.quiet()
    chmodSync(join(ROOT, 'dist', out), 0o755)
  }

  // 2. 平台包 (当前平台装真二进制; 其余平台出空壳包供 CI 补齐)
  for (const platform of PLATFORMS) {
    const dir = join(TMP, 'materin-' + platform)
    mkdirSync(join(dir, 'bin'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), platformPkg(platform))
    if (platform === current) {
      for (const bin of BINS) {
        copyFileSync(join(ROOT, 'dist', bin), join(dir, 'bin', bin))
        chmodSync(join(dir, 'bin', bin), 0o755)
      }
    } else {
      writeFileSync(join(dir, 'bin', '.placeholder'), 'build on ' + platform + ' via bun run compile:*')
    }
  }

  // 3. 主包
  const main = join(TMP, 'materin')
  mkdirSync(join(main, 'bin'), { recursive: true })
  writeFileSync(join(main, 'package.json'), mainPkg())
  for (const bin of BINS) {
    writeFileSync(join(main, 'bin', bin + '.js'), shim(bin))
    chmodSync(join(main, 'bin', bin + '.js'), 0o755)
  }
  if (existsSync(join(ROOT, 'README.md'))) copyFileSync(join(ROOT, 'README.md'), join(main, 'README.md'))
  if (existsSync(join(ROOT, 'LICENSE'))) copyFileSync(join(ROOT, 'LICENSE'), join(main, 'LICENSE'))

  // 4. npm pack
  for (const dir of [join(TMP, 'materin'), ...PLATFORMS.map((p) => join(TMP, 'materin-' + p))]) {
    const r = await $`npm pack ${dir} --pack-destination ${OUT}`.quiet()
  }
  rmSync(TMP, { recursive: true, force: true })
  const files = existsSync(OUT) ? [...new Bun.Glob('*.tgz').scanSync({ cwd: OUT })] : []
  console.log('npm tarballs in ' + OUT + ':')
  for (const f of files) console.log('  ' + f)
}

main()
