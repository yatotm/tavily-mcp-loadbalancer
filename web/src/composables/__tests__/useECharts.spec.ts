// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick, defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { useECharts } from '../useECharts'
import * as echarts from 'echarts'

// Mock echarts
vi.mock('echarts', () => {
  const dispose = vi.fn()
  const resize = vi.fn()
  const setOption = vi.fn()
  const getDom = vi.fn()
  return {
    init: vi.fn(() => ({
      dispose,
      resize,
      setOption,
      getDom,
    })),
  }
})

describe('useECharts', () => {
  let el: HTMLElement

  beforeEach(() => {
    // Mock ResizeObserver
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any

    // Mock getComputedStyle
    window.getComputedStyle = vi.fn().mockReturnValue({
      getPropertyValue: (name: string) => {
        if (name === '--color-text-main') return '#000000'
        return ''
      },
    }) as any

    el = document.createElement('div')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function mountComposable(setupFn: () => any) {
    let result: any
    const wrapper = mount(defineComponent({
      setup() {
        result = setupFn()
        return () => {}
      },
      template: '<div></div>'
    }))
    return { result, wrapper }
  }

  it('initializes chart when element is available', async () => {
    const elRef = ref<HTMLElement | null>(null)
    const { result } = mountComposable(() => useECharts(elRef))
    const { chart } = result

    expect(chart.value).toBeNull()

    elRef.value = el
    await nextTick()
    await nextTick()

    expect(echarts.init).toHaveBeenCalledWith(el, expect.any(Object), expect.any(Object))
    expect(chart.value).not.toBeNull()
  })

  it('disposes chart when element is removed', async () => {
    const elRef = ref<HTMLElement | null>(el)
    const { result } = mountComposable(() => useECharts(elRef))
    const { chart } = result
    await nextTick()

    const disposeSpy = chart.value!.dispose
    
    elRef.value = null
    await nextTick()

    expect(disposeSpy).toHaveBeenCalled()
    expect(chart.value).toBeNull()
  })

  it('updates option when option ref changes', async () => {
    const elRef = ref(el)
    const option = ref({ title: { text: 'test' } })
    const { result } = mountComposable(() => useECharts(elRef, option))
    const { chart } = result
    await nextTick()

    const setOptionSpy = chart.value!.setOption
    expect(setOptionSpy).toHaveBeenCalled()

    option.value = { title: { text: 'updated' } }
    await nextTick()

    expect(setOptionSpy).toHaveBeenCalledTimes(2)
  })

  it('handles resize', async () => {
    const elRef = ref(el)
    const { result } = mountComposable(() => useECharts(elRef))
    const { chart, resize } = result
    await nextTick()

    const resizeSpy = chart.value!.resize
    resize()
    
    // Resize is wrapped in RAF
    await new Promise(resolve => requestAnimationFrame(resolve))
    
    expect(resizeSpy).toHaveBeenCalled()
  })

  it('merges options correctly', async () => {
    const elRef = ref(el)
    const option = ref({
      xAxis: { type: 'category', data: ['a'] },
      yAxis: { type: 'value' },
      tooltip: { show: true }
    })
    const { result } = mountComposable(() => useECharts(elRef, option))
    const { chart } = result
    await nextTick()

    const setOptionSpy = chart.value!.setOption
    const callArgs = setOptionSpy.mock.calls[0][0]
    
    expect(callArgs.xAxis).toBeDefined()
    expect(callArgs.yAxis).toBeDefined()
    expect(callArgs.tooltip).toBeDefined()
    // Check if defaults were applied (e.g. axisLine color)
    expect(callArgs.xAxis.axisLine).toBeDefined()
  })

  it('passes init options', async () => {
    const elRef = ref(el)
    const initOpts = { renderer: 'svg' }
    mountComposable(() => useECharts(elRef, null, initOpts))
    await nextTick()

    expect(echarts.init).toHaveBeenCalledWith(el, expect.any(Object), expect.objectContaining(initOpts))
  })

  it('handles option without axis', async () => {
    const elRef = ref(el)
    const option = ref({ series: [{ type: 'pie' }] })
    const { result } = mountComposable(() => useECharts(elRef, option))
    const { chart } = result
    await nextTick()

    const setOptionSpy = chart.value!.setOption
    const callArgs = setOptionSpy.mock.calls[0][0]
    
    expect(callArgs.xAxis).toBeUndefined()
    expect(callArgs.yAxis).toBeUndefined()
  })

  it('handles array axes', async () => {
    const elRef = ref(el)
    const option = ref({
      xAxis: [{ type: 'category' }, { type: 'value' }],
      yAxis: [{ type: 'value' }]
    })
    mountComposable(() => useECharts(elRef, option))
    await nextTick()
    // Coverage check only
  })
})