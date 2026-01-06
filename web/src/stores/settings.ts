import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useApi } from '../composables/useApi'

export interface SettingsConfig {
  port: number
  host: string
  maxConcurrentRequests: number
  requestTimeoutMs: number
  logRetentionDays: number
  logLevel: string
  logFormat: string
  enableWebUI: boolean
}

export interface SettingsResponse {
  config: SettingsConfig
  authRequired?: boolean
}

export const useSettingsStore = defineStore('settings', () => {
  const config = ref<SettingsConfig | null>(null)
  const authRequired = ref(false)
  const api = useApi()

  const fetchSettings = async () => {
    const data = await api.get<SettingsResponse>('/api/settings')
    config.value = data.config
    authRequired.value = Boolean(data.authRequired)
    return data
  }

  const saveSettings = async (updates: Partial<SettingsConfig>) => {
    const data = await api.put<{ status: string; config: SettingsConfig }>('/api/settings', updates)
    config.value = data.config
    return data.config
  }

  return {
    config,
    authRequired,
    fetchSettings,
    saveSettings,
  }
})
