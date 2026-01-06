import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMock = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}

vi.mock('../../composables/useApi', () => ({
  useApi: () => apiMock,
}))

import { useSettingsStore, type SettingsConfig } from '../settings'

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMock.get.mockReset()
    apiMock.put.mockReset()
  })

  it('fetches settings and authRequired', async () => {
    const store = useSettingsStore()
    const config: SettingsConfig = {
      port: 8080,
      host: 'localhost',
      maxConcurrentRequests: 5,
      requestTimeoutMs: 60000,
      logRetentionDays: 30,
      logLevel: 'info',
      logFormat: 'json',
      enableWebUI: true,
    }

    apiMock.get.mockResolvedValue({ config, authRequired: true })

    const result = await store.fetchSettings()

    expect(apiMock.get).toHaveBeenCalledWith('/api/settings')
    expect(result.config).toEqual(config)
    expect(store.config).toEqual(config)
    expect(store.authRequired).toBe(true)
  })

  it('saves settings updates', async () => {
    const store = useSettingsStore()
    const updated: SettingsConfig = {
      port: 8080,
      host: 'localhost',
      maxConcurrentRequests: 10,
      requestTimeoutMs: 60000,
      logRetentionDays: 30,
      logLevel: 'debug',
      logFormat: 'json',
      enableWebUI: true,
    }

    apiMock.put.mockResolvedValue({ status: 'ok', config: updated })

    const result = await store.saveSettings({ maxConcurrentRequests: 10, logLevel: 'debug' })

    expect(apiMock.put).toHaveBeenCalledWith('/api/settings', {
      maxConcurrentRequests: 10,
      logLevel: 'debug',
    })
    expect(result).toEqual(updated)
    expect(store.config).toEqual(updated)
  })
})
