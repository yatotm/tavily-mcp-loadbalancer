import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useStatsStore } from '../../stores/stats'
import { useWebSocket } from '../useWebSocket'

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  url: string
  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send() {
    // noop
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  triggerMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  triggerClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
}

describe('useWebSocket', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('connects and handles stats_update messages', () => {
    const statsStore = useStatsStore()
    const spy = vi.spyOn(statsStore, 'updateFromWs')

    const { connect, isConnected } = useWebSocket()
    connect('token-123')

    const socket = MockWebSocket.instances[0]
    expect(socket.url).toBe('/ws?token=token-123')

    socket.triggerOpen()
    expect(isConnected.value).toBe(true)

    socket.triggerMessage({ type: 'stats_update', data: { system: { uptime: 1, sse_connections: 0, ws_connections: 1 }, keys: { total: 0, active: 0, disabled: 0, quota_exceeded: 0 }, requests: { total: 0, success: 0, failed: 0, success_rate: 0, avg_response_time_ms: 0 }, quota: { used: 0, limit: null, remaining: null } }, timestamp: 'now' })
    expect(spy).toHaveBeenCalled()

    socket.triggerMessage({ type: 'other_event', data: { foo: 'bar' } })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('reconnects with exponential backoff', () => {
    vi.useFakeTimers()

    const { connect } = useWebSocket()
    connect()

    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()
    socket.triggerClose()

    expect(MockWebSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(1000)
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('stops reconnecting after disconnect', () => {
    vi.useFakeTimers()

    const { connect, disconnect } = useWebSocket()
    connect()

    const socket = MockWebSocket.instances[0]
    socket.triggerOpen()

    disconnect()
    socket.triggerClose()

    vi.advanceTimersByTime(1000)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('does not open a second connection if already connecting', () => {
    const { connect } = useWebSocket()
    connect()
    connect()

    expect(MockWebSocket.instances).toHaveLength(1)
  })
})
