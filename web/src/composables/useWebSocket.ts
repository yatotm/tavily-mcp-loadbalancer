import { ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useStatsStore } from '../stores/stats'

const buildWsUrl = (token?: string) => {
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.host}/ws${query}`
  }
  return `/ws${query}`
}

export const useWebSocket = () => {
  const authStore = useAuthStore()
  const statsStore = useStatsStore()
  const isConnected = ref(false)

  let socket: WebSocket | null = null
  let shouldReconnect = false
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const scheduleReconnect = (token?: string) => {
    clearReconnect()
    const delay = Math.min(1000 * 2 ** reconnectAttempt, 30000)
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      connect(token)
    }, delay)
  }

  const connect = (token?: string) => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    shouldReconnect = true
    clearReconnect()

    const authToken = token ?? authStore.token ?? undefined
    const url = buildWsUrl(authToken)

    socket = new WebSocket(url)

    socket.onopen = () => {
      isConnected.value = true
      reconnectAttempt = 0
    }

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload?.type === 'stats_update' && payload.data) {
          statsStore.updateFromWs(payload.data)
        }
      } catch {
        // ignore malformed payloads
      }
    }

    socket.onclose = () => {
      isConnected.value = false
      socket = null
      if (shouldReconnect) {
        scheduleReconnect(token)
      }
    }

    socket.onerror = () => {
      // rely on close to trigger reconnect
    }
  }

  const disconnect = () => {
    shouldReconnect = false
    clearReconnect()
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      socket.close()
      socket = null
    }
    isConnected.value = false
  }

  return {
    connect,
    disconnect,
    isConnected,
  }
}
