import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '../../stores/auth'
import { useApi } from '../useApi'

const createResponse = (options: { ok: boolean; status: number; body: any }) => {
  return {
    ok: options.ok,
    status: options.status,
    text: vi.fn().mockResolvedValue(JSON.stringify(options.body)),
  } as unknown as Response
}

describe('useApi', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('adds auth token header when present', async () => {
    const auth = useAuthStore()
    auth.login('secret')

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(createResponse({ ok: true, status: 200, body: { status: 'ok' } }))

    const api = useApi()
    await api.get('/api/health')

    const [, options] = fetchMock.mock.calls[0]
    expect((options?.headers as Record<string, string>)['X-Admin-Token']).toBe('secret')
  })

  it('stringifies JSON body for POST', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(createResponse({ ok: true, status: 200, body: { status: 'ok' } }))

    const api = useApi()
    await api.post('/api/keys', { key_value: 'sk-test' })

    const [, options] = fetchMock.mock.calls[0]
    expect(options?.method).toBe('POST')
    expect(options?.body).toBe(JSON.stringify({ key_value: 'sk-test' }))
    expect((options?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('passes through FormData bodies without JSON headers', async () => {
    class MockFormData {}
    vi.stubGlobal('FormData', MockFormData as unknown as typeof FormData)

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(createResponse({ ok: true, status: 200, body: { status: 'ok' } }))

    const api = useApi()
    const formData = new MockFormData()
    await api.post('/api/upload', formData)

    const [, options] = fetchMock.mock.calls[0]
    expect(options?.body).toBe(formData)
    expect((options?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('throws with server error message', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(createResponse({ ok: false, status: 401, body: { error: 'Unauthorized' } }))

    const api = useApi()
    await expect(api.get('/api/keys')).rejects.toThrow('Unauthorized')
  })

  it('returns null for empty 204 responses', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: vi.fn().mockResolvedValue('') } as Response)

    const api = useApi()
    const result = await api.get('/api/health')

    expect(result).toBeNull()
  })

  it('handles non-JSON response bodies', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('plain-text') } as Response)

    const api = useApi()
    const result = await api.get('/api/plain')

    expect(result).toBe('plain-text')
  })

  it('returns null for empty responses', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('') } as Response)

    const api = useApi()
    const result = await api.get('/api/empty')

    expect(result).toBeNull()
  })

  it('supports PUT requests', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(createResponse({ ok: true, status: 200, body: { updated: true } }))

    const api = useApi()
    await api.put('/api/settings', { key: 'val' })

    const [, options] = fetchMock.mock.calls[0]
    expect(options?.method).toBe('PUT')
    expect(options?.body).toBe(JSON.stringify({ key: 'val' }))
  })

  it('supports DELETE requests', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(createResponse({ ok: true, status: 204, body: {} }))

    const api = useApi()
    await api.delete('/api/keys/1')

    const [, options] = fetchMock.mock.calls[0]
    expect(options?.method).toBe('DELETE')
  })
})
