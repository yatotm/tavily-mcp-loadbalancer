import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useApi } from '../composables/useApi'

export interface KeyQuotaSummary {
  used_count: number
  quota_limit: number | null
  remaining: number | null
  search_count: number
  extract_count: number
  crawl_count: number
  map_count: number
}

export type UsageSyncStateStatus = 'never' | 'pending' | 'running' | 'success' | 'error' | 'rate_limited'

export interface UsageSyncState {
  key_id: number
  last_success_at: string | null
  last_attempt_at: string | null
  last_status: UsageSyncStateStatus
  last_error: string | null
  updated_at: string
}

export interface UsageSyncQueueStatus {
  pending: number
  running: number
  runningKeyId: number | null
  blockedUntil: string | null
  nextRequestAt: string | null
  lastRequestAt: string | null
}

export interface UsageSyncEnqueueResult {
  status: 'queued'
  requested: number
  enqueued: number
  deduplicated: number
  promoted: number
  missing: number
  queue: UsageSyncQueueStatus
}

export interface KeyRecord {
  provider?: 'tavily' | 'exa'
  quota_reason?: string | null
  quota_reset_at?: string | null
  billing?: { total_usd: number; reported_usd: number; estimated_usd: number; unsettled: number; official?: { usedUsd: number; period: string } } | null
  id: number
  key_preview: string
  display_name: string
  status: string
  weight: number
  error_count: number
  max_errors: number
  total_requests: number
  successful_requests: number
  failed_requests: number
  last_used_at: string | null
  last_error_at: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
  usage_sync?: UsageSyncState
  quota: KeyQuotaSummary | null
}

export interface KeyCreatePayload {
  provider?: 'tavily' | 'exa'
  key_value: string
  display_name?: string
  weight?: number
  max_errors?: number
}

export interface KeyTestResult {
  status: 'queued' | 'success' | 'error'
  message?: string
  durationMs?: number
  costUsd?: number | null
  costSource?: string
}

export const useKeysStore = defineStore('keys', () => {
  const keys = ref<KeyRecord[]>([])
  const api = useApi()
  const total = ref(0), currentPage = ref(1)
  let sequence = 0

  const fetchKeys = async (params?: { provider: string; page: number; limit: number; keyword?: string; status?: string }) => {
    const request = ++sequence
    const query = params ? '?' + new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)])) : ''
    const data = await api.get<{ keys: KeyRecord[]; total?: number; page?: number }>('/api/keys' + query)
    if (request === sequence) {
      keys.value = data.keys || []
      total.value = data.total ?? keys.value.length
      currentPage.value = data.page ?? 1
    }
    return keys.value
  }

  const addKey = async (payload: KeyCreatePayload) => {
    const data = await api.post<KeyRecord>('/api/keys', payload)
    keys.value = [...keys.value, data]
    return data
  }

  const deleteKey = async (id: number) => {
    await api.delete(`/api/keys/${id}`)
    keys.value = keys.value.filter((key) => key.id !== id)
  }

  const enableKey = async (id: number) => {
    await api.post(`/api/keys/${id}/enable`)
    const existing = keys.value.find((key) => key.id === id)
    if (existing) existing.status = 'active'
  }

  const disableKey = async (id: number) => {
    await api.post(`/api/keys/${id}/disable`)
    const existing = keys.value.find((key) => key.id === id)
    if (existing) existing.status = 'disabled'
  }

  const resetErrors = async (id: number) => {
    await api.post(`/api/keys/${id}/reset`)
    const existing = keys.value.find((key) => key.id === id)
    if (existing) existing.error_count = 0
  }

  const importKeys = async (keyValues: string[], provider: 'tavily' | 'exa' = 'tavily') => {
    const data = await api.post<{ inserted: number }>('/api/keys/import', { keys: keyValues, provider })
    return data.inserted
  }

  const updateKey = async (id: number, updates: { display_name?: string; weight?: number; max_errors?: number }) => {
    await api.put(`/api/keys/${id}`, updates)
    const existing = keys.value.find((key) => key.id === id)
    if (existing) {
      for (const field of ['display_name', 'weight', 'max_errors'] as const) {
        if (updates[field] !== undefined) Object.assign(existing, { [field]: updates[field] })
      }
    }
  }

  const batchEnable = async (ids: number[]) => {
    await api.post('/api/keys/batch/enable', { ids })
    const selected = new Set(ids)
    keys.value = keys.value.map((key) => (selected.has(key.id) ? { ...key, status: 'active' } : key))
  }

  const batchDisable = async (ids: number[]) => {
    await api.post('/api/keys/batch/disable', { ids })
    const selected = new Set(ids)
    keys.value = keys.value.map((key) => (selected.has(key.id) ? { ...key, status: 'disabled' } : key))
  }

  const batchTest = async (ids: number[]): Promise<UsageSyncEnqueueResult> => {
    return api.post<UsageSyncEnqueueResult>('/api/keys/batch/test', { ids })
  }

  const testKey = (id: number) => api.post<KeyTestResult>(`/api/keys/${id}/test`)
  const fetchKey = (id: number) => api.get<KeyRecord>(`/api/keys/${id}`)

  const batchDelete = async (ids: number[], provider: 'tavily' | 'exa') => {
    const data = await api.post<{ deleted: number; ids: number[] }>('/api/keys/batch/delete', { ids, provider })
    sequence++ // A list request started before deletion must not restore the deleted rows.
    const deletedIds = new Set(data.ids)
    keys.value = keys.value.filter(key => !deletedIds.has(key.id))
    return data.deleted
  }

  const fetchUsageSyncStatus = async (): Promise<UsageSyncQueueStatus> => {
    return api.get<UsageSyncQueueStatus>('/api/settings/sync/status')
  }

  return {
    keys, total, currentPage,
    fetchKeys,
    addKey,
    deleteKey,
    enableKey,
    disableKey,
    resetErrors,
    importKeys,
    updateKey,
    batchEnable,
    batchDisable,
    batchTest,
    testKey,
    fetchKey,
    batchDelete,
    fetchUsageSyncStatus,
  }
})
