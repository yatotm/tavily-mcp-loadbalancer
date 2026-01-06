import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface SystemStats {
  uptime: number
  sse_connections: number
  ws_connections: number
}

export interface KeySummaryStats {
  total: number
  active: number
  disabled: number
  quota_exceeded: number
}

export interface RequestStats {
  total: number
  success: number
  failed: number
  success_rate: number
  avg_response_time_ms: number
}

export interface QuotaStats {
  used: number
  limit: number | null
  remaining: number | null
}

export interface StatsOverview {
  system: SystemStats
  keys: KeySummaryStats
  requests: RequestStats
  quota: QuotaStats
}

export interface ToolUsage {
  search: number
  extract: number
  crawl: number
  map: number
}

export interface TimelineData {
  [date: string]: number
}

export interface KeyStatsSummary {
  id: number
  key_preview: string
  display_name: string
  status: string
  total_requests: number
  success: number
  failed: number
  quota?: {
    used_count: number
    quota_limit: number | null
    remaining: number | null
    search_count: number
    extract_count: number
    crawl_count: number
    map_count: number
  } | null
}

export interface StatsApiPayload {
  overview?: StatsOverview
  keys?: KeyStatsSummary[]
  tools?: ToolUsage
  timeline?: TimelineData
}

export const useStatsStore = defineStore('stats', () => {
  const overview = ref<StatsOverview | null>(null)
  const keysSummary = ref<KeyStatsSummary[]>([])
  const tools = ref<ToolUsage | null>(null)
  const timeline = ref<TimelineData>({})

  const updateFromApi = (payload: StatsApiPayload) => {
    if (payload.overview) overview.value = payload.overview
    if (payload.keys) keysSummary.value = payload.keys
    if (payload.tools) tools.value = payload.tools
    if (payload.timeline) timeline.value = payload.timeline
  }

  const updateFromWs = (nextOverview: StatsOverview) => {
    overview.value = nextOverview
  }

  return {
    overview,
    keysSummary,
    tools,
    timeline,
    updateFromApi,
    updateFromWs,
  }
})
