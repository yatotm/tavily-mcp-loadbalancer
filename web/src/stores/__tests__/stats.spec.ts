import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useStatsStore, type StatsOverview, type ToolUsage } from '../stats'

describe('stats store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('updates state from API payload', () => {
    const store = useStatsStore()

    const overview: StatsOverview = {
      system: { uptime: 10, sse_connections: 2, ws_connections: 1 },
      keys: { total: 5, active: 4, disabled: 1, quota_exceeded: 0 },
      requests: { total: 100, success: 90, failed: 10, success_rate: 90, avg_response_time_ms: 120 },
      quota: { used: 50, limit: 100, remaining: 50 },
    }

    const tools: ToolUsage = { search: 10, extract: 5, crawl: 2, map: 1 }
    const timeline = { '2025-01-01': 12 }
    const keys = [
      {
        id: 1,
        key_preview: 'sk-****',
        display_name: 'Primary',
        status: 'active',
        total_requests: 10,
        success: 9,
        failed: 1,
        quota: null,
      },
    ]

    store.updateFromApi({ overview, tools, timeline, keys })

    expect(store.overview).toEqual(overview)
    expect(store.tools).toEqual(tools)
    expect(store.timeline).toEqual(timeline)
    expect(store.keysSummary).toEqual(keys)
  })

  it('updates overview from websocket payload', () => {
    const store = useStatsStore()
    const overview: StatsOverview = {
      system: { uptime: 20, sse_connections: 0, ws_connections: 2 },
      keys: { total: 3, active: 2, disabled: 1, quota_exceeded: 0 },
      requests: { total: 50, success: 45, failed: 5, success_rate: 90, avg_response_time_ms: 80 },
      quota: { used: 30, limit: null, remaining: null },
    }

    store.updateFromWs(overview)
    expect(store.overview).toEqual(overview)
  })
})
