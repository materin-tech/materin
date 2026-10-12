/**
 * 全平台发布打包: bun 交叉编译 + 分平台归档.
 *   macOS (arm64/x64)  → tar.gz + DMG (hdiutil)
 *   Linux (x64/arm64)  → tar.gz
 *   Windows (x64)      → zip (.exe)
 * 产物: release/v<version>/
 */
import { readFileSync, mkdirSync, copyFileSync, rmSync, existsSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const VERSION = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string }).version
const OUT = join(ROOT, 'release', 'v' + VERSION)

const BINS: Array<[string, string]> = [
  ['packages/tui/src/index.ts', 'materin'],
  ['packages/server/src/index.ts', 'materin-server'],
  ['packages/gateway/src/index.ts', 'materin-gateway'],
]

const TARGETS = [
  { target: 'bun-darwin-arm64', platform: 'darwin-arm64', ext: '', kinds: ['tar.gz', 'dmg'] },
  { target: 'bun-darwin-x64', platform: 'darwin-x64', ext: '', kinds: ['tar.gz', 'dmg'] },
  { target: 'bun-linux-x64', platform: 'linux-x64', ext: '', kinds: ['tar.gz'] },
  { target: 'bun-linux-arm64', platform: 'linux-arm64', ext: '', kinds: ['tar.gz'] },
  { target: 'bun-windows-x64', platform: 'windows-x64', ext: '.exe', kinds: ['zip'] },
]

function run(cmd: string[], cwd?: string): void {
  const p = Bun.spawnSync(cmd, { cwd: cwd ?? ROOT, stdout: 'pipe', stderr: 'pipe' })
  if (p.exitCode !== 0) {
    console.error(new TextDecoder().decode(p.stderr))
    throw new Error('command failed: ' + cmd.join(' '))
  }
  console.log('  ok: ' + cmd[0] + ' ' + (cmd[1] ?? ''))
}

function installBat(): string {
  return ['@echo off', 'echo materin v' + VERSION + ' for Windows', 'echo Copy the .exe files to a folder in your PATH, e.g.:', 'echo   mkdir %USERPROFILE%\\bin ^&^& copy materin.exe %USERPROFILE%\\bin\\', ''].join('\n')
}

function main(): void {
  const current = process.platform + '-' + process.arch
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  for (const t of TARGETS) {
    const dir = join(OUT, 'materin-v' + VERSION + '-' + t.platform)
    mkdirSync(dir, { recursive: true })
    for (const [entry, name] of BINS) {
      const out = join(ROOT, 'dist', t.platform, name + t.ext)
      run(['bun', 'build', '--compile', '--target=' + t.target, '--outfile', out, entry], true)
      copyFileSync(out, join(dir, name + t.ext))
      chmodSync(join(dir, name + t.ext), 0o755)
      rmSync(out)
    }
    copyFileSync(join(ROOT, 'README.md'), join(dir, 'README.md'))
    const webDist = join(ROOT, 'packages', 'web', 'dist')
    if (existsSync(join(webDist, 'index.html'))) {
      mkdirSync(join(dir, 'web'), { recursive: true })
      copyFileSync(join(webDist, 'index.html'), join(dir, 'web', 'index.html'))
      copyFileSync(join(webDist, 'main.js'), join(dir, 'web', 'main.js'))
    }
    if (existsSync(join(ROOT, 'docs', 'guide.md'))) {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      copyFileSync(join(ROOT, 'docs', 'guide.md'), join(dir, 'docs', 'guide.md'))
    }
    if (t.ext === '') copyFileSync(join(ROOT, 'install.sh'), join(dir, 'install.sh'))
    else writeFileSync(join(dir, 'install.bat'), installBat())

    const base = 'materin-v' + VERSION + '-' + t.platform
    if (t.kinds.includes('tar.gz')) run(['tar', 'czf', join(OUT, base + '.tar.gz'), '-C', OUT, base])
    if (t.kinds.includes('zip')) run(['zip', '-rq', base + '.zip', base], OUT)
    if (t.kinds.includes('dmg') && t.platform === current) {
      run(['hdiutil', 'create', '-volname', 'materin ' + VERSION, '-srcfolder', dir, '-ov', '-format', 'UDZO', join(OUT, base + '.dmg')], true)
    } else if (t.kinds.includes('dmg')) {
      console.log('  skip dmg for ' + t.platform + ' (dmg creation requires macOS; built on ' + current + ')')
    }
    console.log('packed ' + base + ' (' + t.kinds.join(' + ') + ')')
  }

  const sums: string[] = []
  for (const f of [...new Bun.Glob('*.tar.gz').scanSync({ cwd: OUT }), ...new Bun.Glob('*.zip').scanSync({ cwd: OUT }), ...new Bun.Glob('*.dmg').scanSync({ cwd: OUT })]) {
    const h = new Bun.CryptoHasher('sha256')
    h.update(readFileSync(join(OUT, f)))
    sums.push(h.digest('hex') + '  ' + f)
  }
  writeFileSync(join(OUT, 'SHA256SUMS'), sums.join('\n') + '\n')
  console.log('SHA256SUMS written (' + sums.length + ' artifacts) → ' + OUT)
}

main()
