import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { AUTH_TOKEN_KEY, useAuthStore } from '../auth'

const createStorageMock = () => {
  const store = new Map<string, string>()
  return {
    store,
    localStorage: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key)
      }),
    },
  }
}

describe('auth store', () => {
  const storageMock = createStorageMock()

  beforeEach(() => {
    storageMock.store.clear()
    setActivePinia(createPinia())
    vi.stubGlobal('window', { localStorage: storageMock.localStorage })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('hydrates token from localStorage', () => {
    storageMock.store.set(AUTH_TOKEN_KEY, 'stored-token')
    const store = useAuthStore()
    expect(store.token).toBe('stored-token')
  })

  it('persists token on login and clears on logout', () => {
    const store = useAuthStore()
    store.setAuthRequired(true)
    expect(store.authRequired).toBe(true)

    store.login(' secret ')
    expect(store.token).toBe('secret')
    expect(storageMock.localStorage.setItem).toHaveBeenCalledWith(AUTH_TOKEN_KEY, 'secret')
    expect(store.authRequired).toBe(false)

    store.logout()
    expect(store.token).toBeNull()
    expect(storageMock.localStorage.removeItem).toHaveBeenCalledWith(AUTH_TOKEN_KEY)
    expect(store.authRequired).toBe(true)
  })

  it('works without localStorage available', () => {
    vi.unstubAllGlobals()
    setActivePinia(createPinia())

    const store = useAuthStore()
    expect(store.token).toBeNull()

    store.login('fallback')
    expect(store.token).toBe('fallback')

    store.logout()
    expect(store.token).toBeNull()
  })
})
