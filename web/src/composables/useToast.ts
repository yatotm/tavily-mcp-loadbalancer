import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  type: ToastType
  message: string
}

const MAX_TOASTS = 5
const AUTO_DISMISS_MS = 3000

const toasts = ref<ToastItem[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let toastId = 0

const removeToast = (id: number) => {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

const addToast = (type: ToastType, message: string) => {
  const id = toastId++
  const toast: ToastItem = { id, type, message }
  toasts.value = [...toasts.value, toast]

  if (toasts.value.length > MAX_TOASTS) {
    const overflow = toasts.value.slice(0, toasts.value.length - MAX_TOASTS)
    overflow.forEach((item) => removeToast(item.id))
  }

  const timer = setTimeout(() => removeToast(id), AUTO_DISMISS_MS)
  timers.set(id, timer)
}

export const useToast = () => {
  const success = (message: string) => addToast('success', message)
  const error = (message: string) => addToast('error', message)
  const info = (message: string) => addToast('info', message)

  return {
    toasts,
    success,
    error,
    info,
  }
}
