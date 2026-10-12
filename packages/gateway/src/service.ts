import { writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import { materinHome } from '@materin/core'

/**
 * 系统服务 (开机自启): macOS launchd / Linux systemd user service.
 * install-service / uninstall-service. 服务以 `fg` 前台模式被 init 托管.
 */

const LABEL = 'dev.materin.gateway'

function binaryPath(): string {
  const compiled = import.meta.url.includes('$bunfs')
  if (!compiled) {
    console.log('提示: dev 模式下服务指向 bun+源码路径, 建议编译后安装 (bun run compile:gateway)')
  }
  return process.execPath
}

export function serviceInstall(): number {
  const bin = binaryPath()
  if (process.platform === 'darwin') {
    const plistDir = join(homedir(), 'Library', 'LaunchAgents')
    const plist = join(plistDir, LABEL + '.plist')
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
      '<plist version="1.0"><dict>\n' +
      '  <key>Label</key><string>' + LABEL + '</string>\n' +
      '  <key>ProgramArguments</key><array>\n' +
      '    <string>' + bin + '</string><string>fg</string>\n' +
      '  </array>\n' +
      '  <key>RunAtLoad</key><true/>\n' +
      '  <key>KeepAlive</key><true/>\n' +
      '  <key>StandardOutPath</key><string>' + join(materinHome(), 'gateway.log') + '</string>\n' +
      '  <key>StandardErrorPath</key><string>' + join(materinHome(), 'gateway.log') + '</string>\n' +
      '</dict></plist>\n'
    writeFileSync(plist, xml)
    void $`launchctl unload ${plist}`.quiet().catch(() => {})
    void $`launchctl load -w ${plist}`.quiet().catch(() => {})
    console.log('launchd 服务已安装: ' + plist)
    console.log('(RunAtLoad + KeepAlive — 开机自启, 崩溃自动拉起)')
    return 0
  }
  if (process.platform === 'linux') {
    const unitDir = join(homedir(), '.config', 'systemd', 'user')
    const unit = join(unitDir, LABEL + '.service')
    const text = '[Unit]\nDescription=materin gateway (AI agent channel bot)\nAfter=network-online.target\n\n[Service]\nExecStart=' + bin + ' fg\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n'
    writeFileSync(unit, text)
    void $`systemctl --user daemon-reload`.quiet().catch(() => {})
    void $`systemctl --user enable --now ${LABEL}.service`.quiet().catch(() => {})
    console.log('systemd 用户服务已安装并启动: ' + unit)
    return 0
  }
  console.log('不支持的平台: ' + process.platform)
  return 1
}

export function serviceUninstall(): number {
  if (process.platform === 'darwin') {
    const plist = join(homedir(), 'Library', 'LaunchAgents', LABEL + '.plist')
    if (!existsSync(plist)) {
      console.log('服务未安装')
      return 0
    }
    void $`launchctl unload ${plist}`.quiet().catch(() => {})
    unlinkSync(plist)
    console.log('launchd 服务已移除')
    return 0
  }
  if (process.platform === 'linux') {
    const unit = join(homedir(), '.config', 'systemd', 'user', LABEL + '.service')
    void $`systemctl --user disable --now ${LABEL}.service`.quiet().catch(() => {})
    if (existsSync(unit)) unlinkSync(unit)
    void $`systemctl --user daemon-reload`.quiet().catch(() => {})
    console.log('systemd 服务已移除')
    return 0
  }
  console.log('不支持的平台: ' + process.platform)
  return 1
}
