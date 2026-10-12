/**
 * 全平台发布打包 — 进程内 Bun.build 交叉编译 (无 spawn bun, 规避 PATH/shim 问题).
 *   macOS (arm64/x64) → tar.gz + DMG (hdiutil)
 *   Linux (x64/arm64) → tar.gz
 *   Windows (x64)     → zip (.exe)
 * 产物: release/v<version>/
 */
import { readFileSync, mkdirSync, copyFileSync, rmSync, existsSync, writeFileSync, chmodSync, cpSync } from 'node:fs'
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
  console.log('  ok: ' + cmd[0])
}

function startGuiSh(): string {
  return ['#!/usr/bin/env bash', 'DIR="$(cd "$(dirname "$0")" && pwd)"', 'PORT="${MATERIN_PORT:-4128}"', 'echo "starting materin gui at http://127.0.0.1:$PORT/ui/"', '"$DIR/materin-server" &', 'SERVER_PID=$!', 'sleep 1.5', '( open "http://127.0.0.1:$PORT/ui/" 2>/dev/null || xdg-open "http://127.0.0.1:$PORT/ui/" 2>/dev/null ) || echo "open http://127.0.0.1:$PORT/ui/"', 'echo "server pid $SERVER_PID — stop with: kill $SERVER_PID"', 'wait $SERVER_PID', ''].join('\n')
}

function startGuiBat(): string {
  return ['@echo off', 'set PORT=4128', 'echo starting materin gui at http://127.0.0.1:%PORT%/ui/', 'start /b "" "%~dp0materin-server.exe"', 'timeout /t 2 >nul', 'start "" "http://127.0.0.1:%PORT%/ui/"', 'echo (server runs in background; kill via Task Manager: materin-server.exe)', ''].join('\r\n')
}

function linuxDesktopFile(): string {
  return ['[Desktop Entry]', 'Type=Application', 'Name=materin', 'Comment=AI coding agent', 'Exec=bash -c "cd $(dirname %k) && ./start-gui.sh"', 'Terminal=false', 'Categories=Development;', ''].join('\n')
}

function installBat(): string {
  return ['@echo off', 'echo materin v' + VERSION + ' for Windows', 'echo Copy the .exe files to a folder in your PATH, e.g.:', 'echo   mkdir %USERPROFILE%\\bin ^&^& copy materin.exe %USERPROFILE%\\bin\\', ''].join('\n')
}

async function compile(target: string, entry: string, out: string): Promise<void> {
  const r = await Bun.build({
    entrypoints: [join(ROOT, entry)],
    compile: { target: target as never, outfile: out },
  })
  if (!r.success) {
    for (const l of r.logs) console.error(l)
    throw new Error('compile failed: ' + target + ' ' + entry)
  }
  chmodSync(out, 0o755)
}

async function main(): Promise<void> {
  const current = process.platform + '-' + process.arch
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  // 版本同步: package.json -> core/version.ts (编译前)
  writeFileSync(
    join(ROOT, 'packages/core/src/version.ts'),
    '/** 编译时生成 — 唯一事实源: 根 package.json */\nexport const VERSION = \'' + VERSION + '\'\n',
  )

  const webDist = join(ROOT, 'packages', 'web', 'dist')
  const hasWeb = existsSync(join(webDist, 'index.html'))
  if (!hasWeb) {
    console.log('web dist missing — building...')
    run([process.execPath, 'run', 'web:build'])
  }

  for (const t of TARGETS) {
    const dir = join(OUT, 'materin-v' + VERSION + '-' + t.platform)
    mkdirSync(dir, { recursive: true })
    for (const [entry, name] of BINS) {
      const tmp = join(ROOT, 'dist', t.platform, name + t.ext)
      await compile(t.target, entry, tmp)
      copyFileSync(tmp, join(dir, name + t.ext))
      rmSync(tmp)
    }
    copyFileSync(join(ROOT, 'README.md'), join(dir, 'README.md'))
    if (hasWeb) {
      mkdirSync(join(dir, 'web'), { recursive: true })
      copyFileSync(join(webDist, 'index.html'), join(dir, 'web', 'index.html'))
      copyFileSync(join(webDist, 'main.js'), join(dir, 'web', 'main.js'))
    }
    if (existsSync(join(ROOT, 'docs', 'guide.md'))) {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      copyFileSync(join(ROOT, 'docs', 'guide.md'), join(dir, 'docs', 'guide.md'))
    }
    if (t.ext === '') {
      copyFileSync(join(ROOT, 'install.sh'), join(dir, 'install.sh'))
      writeFileSync(join(dir, 'start-gui.sh'), startGuiSh())
      chmodSync(join(dir, 'start-gui.sh'), 0o755)
    } else {
      writeFileSync(join(dir, 'install.bat'), installBat())
      writeFileSync(join(dir, 'start-gui.bat'), startGuiBat())
    }
    if (t.platform.startsWith('linux')) writeFileSync(join(dir, 'materin.desktop'), linuxDesktopFile())

    const base = 'materin-v' + VERSION + '-' + t.platform
    if (t.kinds.includes('tar.gz')) run(['tar', 'czf', join(OUT, base + '.tar.gz'), '-C', OUT, base])
    if (t.kinds.includes('zip')) run(['zip', '-rq', base + '.zip', base], OUT)
    if (t.kinds.includes('dmg')) {
      if (t.platform === current) {
        const stage = join(OUT, 'dmg-stage')
        rmSync(stage, { recursive: true, force: true })
        mkdirSync(stage, { recursive: true })
        cpSync(dir, join(stage, base), { recursive: true })
        run(['hdiutil', 'create', '-volname', 'materin ' + VERSION, '-srcfolder', stage, '-ov', '-format', 'UDZO', join(OUT, base + '.dmg')])
        rmSync(stage, { recursive: true, force: true })
      } else {
        console.log('  skip dmg for ' + t.platform + ' (dmg requires building on macOS)')
      }
    }
    console.log('packed ' + base)
  }

  const sums: string[] = []
  for (const pat of ['*.tar.gz', '*.zip', '*.dmg']) {
    for (const f of new Bun.Glob(pat).scanSync({ cwd: OUT })) {
      const h = new Bun.CryptoHasher('sha256')
      h.update(readFileSync(join(OUT, f)))
      sums.push(h.digest('hex') + '  ' + f)
    }
  }
  writeFileSync(join(OUT, 'SHA256SUMS'), sums.join('\n') + '\n')
  console.log('SHA256SUMS (' + sums.length + ' artifacts) → ' + OUT)
}

main()
