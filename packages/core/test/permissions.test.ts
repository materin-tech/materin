import { describe, test, expect } from 'bun:test'
import { PermissionManager, parsePermissionRules, wildcardMatch } from '../src/permissions'

describe('PermissionManager', () => {
  test('last matching rule wins', () => {
    const perms = new PermissionManager([
      { tool: 'bash', action: 'allow' },
      { tool: 'bash', pattern: 'rm *', action: 'deny' },
    ])
    expect(perms.check('bash', { command: 'rm -rf /tmp/x' })).toBe('deny')
    expect(perms.check('bash', { command: 'git status' })).toBe('allow')
  })

  test('defaults to allow when no rule matches (M2 permissive default)', () => {
    const perms = new PermissionManager([{ tool: 'bash', pattern: 'rm *', action: 'deny' }])
    expect(perms.check('read', { file_path: '/tmp/a.txt' })).toBe('allow')
  })

  test('doom loop: 3 identical consecutive calls force ask', () => {
    const perms = new PermissionManager()
    const args = { command: 'sleep 1' }
    perms.record('bash', args)
    perms.record('bash', args)
    expect(perms.check('bash', args)).toBe('allow')
    perms.record('bash', args)
    expect(perms.check('bash', args)).toBe('ask')
    expect(perms.check('bash', { command: 'other' })).toBe('allow')
  })

  test('wildcard matches anything and other chars are literal', () => {
    expect(wildcardMatch('*', 'anything at all')).toBe(true)
    expect(wildcardMatch('a*b', 'aXXXb')).toBe(true)
    expect(wildcardMatch('a*b', 'b')).toBe(false)
    // '.' must not become a regex wildcard
    expect(wildcardMatch('a.b', 'axb')).toBe(false)
    expect(wildcardMatch('a.b', 'a.b')).toBe(true)
  })

  test('pattern targets command for bash and file_path for file tools', () => {
    const perms = new PermissionManager([
      { tool: 'read', pattern: '/tmp/*', action: 'deny' },
    ])
    expect(perms.check('read', { file_path: '/tmp/secret.txt' })).toBe('deny')
    expect(perms.check('read', { file_path: '/home/other.txt' })).toBe('allow')
  })

  test('parsePermissionRules reads the env format', () => {
    const rules = parsePermissionRules('bash:deny:rm *;read:ask')
    expect(rules).toHaveLength(2)
    expect(rules[0]).toEqual({ tool: 'bash', pattern: 'rm *', action: 'deny' })
    expect(rules[1]).toEqual({ tool: 'read', action: 'ask' })
    expect(parsePermissionRules('')).toEqual([])
  })
})
