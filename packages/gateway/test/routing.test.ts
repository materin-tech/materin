import { describe, test, expect } from 'bun:test'
import { openDb, SessionStore } from '@materin/core'

describe('gateway_routing store methods', () => {
  test('get/set roundtrip and upsert', () => {
    const store = new SessionStore(openDb(':memory:'))
    expect(store.getRoutingSession('feishu', 'oc_x', 'ou_1')).toBeNull()

    store.setRoutingSession('feishu', 'oc_x', 'ou_1', 's1')
    expect(store.getRoutingSession('feishu', 'oc_y', 'ou_1')).toBeNull()
    expect(store.getRoutingSession('feishu', 'oc_x', 'ou_1')).toBe('s1')

    store.setRoutingSession('feishu', 'oc_x', 'ou_1', 's2')
    expect(store.getRoutingSession('feishu', 'oc_x', 'ou_1')).toBe('s2')
    expect(store.getRoutingSession('feishu', 'oc_x', 'ou_1')).toBe('s2')
    expect(store.getRoutingSession('feishu', 'oc_x', 'ou_2')).toBeNull()
  })
})
