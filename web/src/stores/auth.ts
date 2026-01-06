import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const AUTH_TOKEN_KEY = 'tavily_admin_token'

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

const readToken = (): string | null => {
  if (!canUseStorage()) return null
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY)
  } catch {
    return null
  }
}

const writeToken = (value: string | null) => {
  if (!canUseStorage()) return
  try {
    if (value) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, value)
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_KEY)
    }
  } catch {
    // ignore storage errors (private mode, blocked, etc.)
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(readToken())
  const requiresAuth = ref(false)

  const authRequired = computed(() => requiresAuth.value && !token.value)

  const setAuthRequired = (value: boolean) => {
    requiresAuth.value = value
  }

  const login = (password: string) => {
    const next = password.trim()
    token.value = next || null
    writeToken(token.value)
  }

  const logout = () => {
    token.value = null
    writeToken(null)
  }

  return {
    token,
    requiresAuth,
    authRequired,
    setAuthRequired,
    login,
    logout,
  }
})
