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

export interface KeyRecord {
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
  quota: KeyQuotaSummary | null
}

export interface KeyCreatePayload {
  key_value: string
  display_name?: string
  weight?: number
  max_errors?: number
}

export const useKeysStore = defineStore('keys', () => {
  const keys = ref<KeyRecord[]>([])
  const api = useApi()

  const fetchKeys = async () => {
    const data = await api.get<{ keys: KeyRecord[] }>('/api/keys')
    keys.value = data.keys || []
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

  const importKeys = async (keyValues: string[]) => {
    const data = await api.post<{ inserted: number }>('/api/keys/import', { keys: keyValues })
    return data.inserted
  }

  const updateKey = async (id: number, updates: { display_name?: string; weight?: number; max_errors?: number }) => {
    await api.put(`/api/keys/${id}`, updates)
    const existing = keys.value.find((key) => key.id === id)
    if (existing && updates.display_name !== undefined) {
      existing.display_name = updates.display_name
    }
  }

  return {
    keys,
    fetchKeys,
    addKey,
    deleteKey,
    enableKey,
    disableKey,
    resetErrors,
    importKeys,
    updateKey,
  }
})
