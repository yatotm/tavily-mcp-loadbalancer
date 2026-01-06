import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToast } from '../useToast'

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    const { toasts } = useToast()
    toasts.value = []
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
    const { toasts } = useToast()
    toasts.value = []
  })

  it('limits the queue to 5 toasts', () => {
    const { toasts, success } = useToast()

    for (let i = 0; i < 6; i += 1) {
      success(`Toast ${i}`)
    }

    expect(toasts.value).toHaveLength(5)
    expect(toasts.value[0].message).toBe('Toast 1')
  })

  it('auto-dismisses toasts after 3 seconds', () => {
    const { toasts, info } = useToast()

    info('Saved')
    expect(toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(3000)
    expect(toasts.value).toHaveLength(0)
  })
})
