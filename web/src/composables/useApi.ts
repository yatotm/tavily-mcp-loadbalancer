import { useAuthStore } from '../stores/auth'

interface ApiRequestOptions extends RequestInit {
  body?: any
}

const parseResponse = async (response: Response) => {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const useApi = () => {
  const authStore = useAuthStore()

  const request = async <T>(url: string, options: ApiRequestOptions = {}): Promise<T> => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
    }

    if (authStore.token) {
      headers['X-Admin-Token'] = authStore.token
    }

    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData

    if (options.body !== undefined && !isFormData) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json'
    }

    const body =
      options.body !== undefined && !isFormData
        ? JSON.stringify(options.body)
        : options.body

    const response = await fetch(url, {
      ...options,
      headers,
      body,
    })

    const data = await parseResponse(response)

    if (!response.ok) {
      if (response.status === 401) {
        authStore.setAuthRequired(true)
        authStore.logout()
      }
      const message =
        (data && typeof data === 'object' && 'error' in data && (data as any).error) ||
        (data && typeof data === 'object' && 'message' in data && (data as any).message) ||
        (typeof data === 'string' && data) ||
        `Request failed with status ${response.status}`
      throw new Error(message)
    }

    return data as T
  }

  const get = <T>(url: string, options: RequestInit = {}) =>
    request<T>(url, { ...options, method: 'GET' })

  const post = <T>(url: string, body?: any, options: RequestInit = {}) =>
    request<T>(url, { ...options, method: 'POST', body })

  const put = <T>(url: string, body?: any, options: RequestInit = {}) =>
    request<T>(url, { ...options, method: 'PUT', body })

  const del = <T>(url: string, options: RequestInit = {}) =>
    request<T>(url, { ...options, method: 'DELETE' })

  return {
    get,
    post,
    put,
    delete: del,
  }
}
