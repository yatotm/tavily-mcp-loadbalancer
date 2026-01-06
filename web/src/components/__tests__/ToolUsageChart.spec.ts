// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolUsageChart from '../ToolUsageChart.vue'
import { useECharts } from '../../composables/useECharts'

// Mock useECharts
vi.mock('../../composables/useECharts', () => ({
  useECharts: vi.fn()
}))

describe('ToolUsageChart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state', () => {
    const wrapper = mount(ToolUsageChart, {
      props: { data: null, loading: true },
      global: {
        stubs: {
          ElSkeleton: true
        }
      }
    })
    expect(wrapper.find('.loading-container').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ElSkeleton' }).exists()).toBe(true)
  })

  it('renders chart container when not loading', () => {
    const wrapper = mount(ToolUsageChart, {
      props: { 
        data: { search: 10, extract: 5, crawl: 2, map: 1 }, 
        loading: false 
      },
      global: {
        stubs: {
          ElSkeleton: true
        }
      }
    })
    expect(wrapper.find('.chart').exists()).toBe(true)
    expect(useECharts).toHaveBeenCalled()
  })

  it('passes correct option with data', () => {
    const data = { search: 10, map: 20, crawl: 5, extract: 15 }
    mount(ToolUsageChart, {
      props: { data, loading: false },
      global: { stubs: { ElSkeleton: true } }
    })
    
    const args = (useECharts as any).mock.calls[0]
    const option = args[1].value
    
    // Should be sorted desc: map(20), extract(15), search(10), crawl(5)
    expect(option.yAxis.data).toEqual(['map', 'extract', 'search', 'crawl'])
    expect(option.series[0].data.map((d: any) => d.value)).toEqual([20, 15, 10, 5])
  })

  it('handles empty data with defaults', () => {
    mount(ToolUsageChart, {
      props: { data: {}, loading: false },
      global: { stubs: { ElSkeleton: true } }
    })
    
    const args = (useECharts as any).mock.calls[0]
    const option = args[1].value
    
    expect(option.series[0].data.length).toBe(4)
    expect(option.series[0].data.every((d: any) => d.value === 0)).toBe(true)
  })
  
  it('handles null data with defaults', () => {
    mount(ToolUsageChart, {
      props: { data: null, loading: false },
      global: { stubs: { ElSkeleton: true } }
    })
    
    const args = (useECharts as any).mock.calls[0]
    const option = args[1].value
    
    expect(option.series[0].data.length).toBe(4)
    expect(option.series[0].data.every((d: any) => d.value === 0)).toBe(true)
  })

  it('formats tooltip correctly', () => {
    mount(ToolUsageChart, {
      props: { 
        data: { search: 10, extract: 10, crawl: 0, map: 0 }, 
        loading: false 
      },
      global: { stubs: { ElSkeleton: true } }
    })
    
    const args = (useECharts as any).mock.calls[0]
    const option = args[1].value
    const formatter = option.tooltip.formatter
    
    // Total is 20. 10 is 50%.
    const params = [{
      name: 'search',
      value: 10,
      marker: 'DOT',
      seriesName: 'series'
    }]
    
    const result = formatter(params)
    expect(result).toContain('search')
    expect(result).toContain('10 (50.0%)')
    expect(result).toContain('DOT')

    // Test object params and zero total
    const paramsObj = { name: 'map', value: 0, marker: 'X' }
    // We need to access total from closure, but we can't easily.
    // However, if we mount with empty data, total is 0.
    // But then 'values' is [0,0,0,0].
  })

  it('formats tooltip with zero total', () => {
    mount(ToolUsageChart, {
      props: { data: {}, loading: false },
      global: { stubs: { ElSkeleton: true } }
    })
    
    const args = (useECharts as any).mock.calls[0]
    const option = args[1].value
    const formatter = option.tooltip.formatter
    
    const result = formatter({ name: 'map', value: 0, marker: 'X' }) // Object param
    expect(result).toContain('map')
    expect(result).toContain('0 (0.0%)')
  })
})
