import { writeFileSync, readFileSync, existsSync, unlinkSync, openSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { materinHome } from '@materin/core'

/**
 * gateway 后台运行 (daemon): start/stop/status/logs/restart.
 * PID 与日志存于数据根目录. 实现方式: detached 子进程 + --daemon-child 标记.
 */

export function pidFile(): string {
  return join(materinHome(), 'gateway.pid')
}

export function logFile(): string {
  return join(materinHome(), 'gateway.log')
}

export function readPid(): number | null {
  if (!existsSync(pidFile())) return null
  const pid = Number.parseInt(readFileSync(pidFile(), 'utf-8').trim(), 10)
  return Number.isInteger(pid) ? pid : null
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function runningPid(): number | null {
  const pid = readPid()
  return pid && isRunning(pid) ? pid : null
}

export function daemonStart(): number {
  const alive = runningPid()
  if (alive) {
    console.log('materin-gateway 已在运行 (pid ' + alive + ')')
    return 1
  }
  mkdirSync(join(logFile(), '..'), { recursive: true })
  const logFd = openSync(logFile(), 'a', 0o644)
  const childArgs = process.argv.slice(1).filter((a) => a !== 'start' && a !== 'restart') // 兼容 dev: [bun, script, ...] 与编译: [binary, ...]
  const child = Bun.spawn([process.execPath, ...childArgs, '--daemon-child'], {
    stdin: 'ignore',
    stdout: logFd,
    stderr: logFd,
  })
  writeFileSync(pidFile(), String(child.pid))
  appendFileSync(logFile(), '[daemon] started pid ' + child.pid + ' at ' + new Date().toISOString() + '\n')
  console.log('materin-gateway 已后台启动 (pid ' + child.pid + ')')
  console.log('日志: materin-gateway logs [-f]   停止: materin-gateway stop')
  return 0
}

export function daemonStop(): number {
  const pid = runningPid()
  if (!pid) {
    if (readPid()) unlinkSync(pidFile())
    console.log('materin-gateway 未在运行')
    return 0
  }
  process.kill(pid, 'SIGTERM')
  for (let i = 0; i < 30; i++) {
    if (!isRunning(pid)) break
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
  if (isRunning(pid)) {
    process.kill(pid, 'SIGKILL')
    console.log('materin-gateway 已强制停止 (pid ' + pid + ')')
  } else {
    console.log('materin-gateway 已停止 (pid ' + pid + ')')
  }
  if (existsSync(pidFile())) unlinkSync(pidFile())
  return 0
}

export function daemonStatus(): number {
  const pid = runningPid()
  if (!pid) {
    console.log('materin-gateway: stopped')
    return 1
  }
  console.log('materin-gateway: running (pid ' + pid + ')')
  if (existsSync(logFile())) {
    const lines = readFileSync(logFile(), 'utf-8').trimEnd().split('\n')
    for (const line of lines.slice(-5)) console.log('  | ' + line)
  }
  return 0
}

export function daemonLogs(follow: boolean): number {
  if (!existsSync(logFile())) {
    console.log('(no logs yet: ' + logFile() + ')')
    return 0
  }
  if (!follow) {
    const lines = readFileSync(logFile(), 'utf-8').trimEnd().split('\n')
    for (const line of lines.slice(-50)) console.log(line)
    return 0
  }
  const child = Bun.spawn(['tail', '-n', '50', '-f', logFile()], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  void child.exited
  return 0
}
