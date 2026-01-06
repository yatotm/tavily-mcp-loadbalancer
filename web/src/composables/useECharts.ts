import { nextTick, onBeforeUnmount, shallowRef, unref, watch, type ComputedRef, type Ref } from 'vue'
import * as echarts from 'echarts'
import type { ECharts, EChartsOption, SetOptionOpts } from 'echarts'

export const GOOGLE_BRAND_COLORS = ['#4285F4', '#EA4335', '#FBBC05', '#34A853'] as const

type MaybeRef<T> = T | Ref<T> | ComputedRef<T>
type InitType = Parameters<typeof echarts.init>[2]

interface ThemeTokens {
  textMain: string
  textSecondary: string
  border: string
  surface: string
  fontFamily: string
  shadowSm: string
  radiusBase: number
}

const getCssVar = (name: string, fallback: string) => {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name)
  return value?.trim() || fallback
}

const getCssVarNumber = (name: string, fallback: number) => {
  const value = getCssVar(name, `${fallback}`)
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const getThemeTokens = (): ThemeTokens => ({
  textMain: getCssVar('--color-text-main', '#1f2937'),
  textSecondary: getCssVar('--color-text-secondary', '#6b7280'),
  border: getCssVar('--color-border', '#e5e7eb'),
  surface: getCssVar('--color-surface', '#ffffff'),
  fontFamily: getCssVar('--font-family-base', 'system-ui, sans-serif'),
  shadowSm: getCssVar('--shadow-sm', '0 1px 2px 0 rgba(0, 0, 0, 0.05)'),
  radiusBase: getCssVarNumber('--radius-base', 6),
})

const buildTheme = () => {
  const tokens = getThemeTokens()
  return {
    color: [...GOOGLE_BRAND_COLORS],
    backgroundColor: 'transparent',
    textStyle: {
      color: tokens.textMain,
      fontFamily: tokens.fontFamily,
    },
    title: {
      textStyle: {
        color: tokens.textMain,
        fontFamily: tokens.fontFamily,
        fontWeight: 600,
      },
      subtextStyle: {
        color: tokens.textSecondary,
        fontFamily: tokens.fontFamily,
      },
    },
    legend: {
      textStyle: {
        color: tokens.textSecondary,
        fontFamily: tokens.fontFamily,
      },
    },
  }
}

const buildAxisDefaults = (tokens: ThemeTokens) => ({
  axisLine: {
    lineStyle: { color: tokens.border },
  },
  axisTick: {
    lineStyle: { color: tokens.border },
  },
  axisLabel: {
    color: tokens.textSecondary,
    fontSize: 12,
    fontFamily: tokens.fontFamily,
  },
  splitLine: {
    lineStyle: { color: tokens.border, opacity: 0.6 },
  },
  nameTextStyle: {
    color: tokens.textSecondary,
    fontFamily: tokens.fontFamily,
  },
})

const buildTooltipDefaults = (tokens: ThemeTokens) => ({
  trigger: 'axis' as const,
  backgroundColor: tokens.surface,
  borderColor: tokens.border,
  borderWidth: 1,
  padding: [8, 12],
  textStyle: {
    color: tokens.textMain,
    fontSize: 12,
    fontFamily: tokens.fontFamily,
  },
  axisPointer: {
    type: 'line' as const,
    lineStyle: {
      color: tokens.border,
      type: 'dashed' as const,
    },
  },
  extraCssText: `border-radius:${tokens.radiusBase}px; box-shadow:${tokens.shadowSm};`,
})

const mergeLineStyle = (base?: Record<string, any>, overrides?: Record<string, any>) => ({
  ...(base ?? {}),
  ...(overrides ?? {}),
})

const mergeAxis = (axis: Record<string, any> | undefined, defaults: Record<string, any>) => {
  const merged = {
    ...defaults,
    ...(axis ?? {}),
  }
  merged.axisLine = {
    ...defaults.axisLine,
    ...(axis?.axisLine ?? {}),
    lineStyle: mergeLineStyle(defaults.axisLine?.lineStyle, axis?.axisLine?.lineStyle),
  }
  merged.axisTick = {
    ...defaults.axisTick,
    ...(axis?.axisTick ?? {}),
    lineStyle: mergeLineStyle(defaults.axisTick?.lineStyle, axis?.axisTick?.lineStyle),
  }
  merged.axisLabel = {
    ...defaults.axisLabel,
    ...(axis?.axisLabel ?? {}),
  }
  merged.splitLine = {
    ...defaults.splitLine,
    ...(axis?.splitLine ?? {}),
    lineStyle: mergeLineStyle(defaults.splitLine?.lineStyle, axis?.splitLine?.lineStyle),
  }
  merged.nameTextStyle = {
    ...defaults.nameTextStyle,
    ...(axis?.nameTextStyle ?? {}),
  }
  return merged
}

const mergeAxes = (axis: unknown, defaults: Record<string, any>) => {
  if (Array.isArray(axis)) {
    return axis.map((item) => mergeAxis(item as Record<string, any>, defaults))
  }
  return mergeAxis(axis as Record<string, any> | undefined, defaults)
}

const mergeTooltip = (defaults: Record<string, any>, tooltip: unknown) => {
  if (!tooltip || typeof tooltip !== 'object' || Array.isArray(tooltip)) {
    return defaults
  }
  const next = tooltip as Record<string, any>
  return {
    ...defaults,
    ...next,
    textStyle: {
      ...defaults.textStyle,
      ...(next.textStyle ?? {}),
    },
    axisPointer: {
      ...defaults.axisPointer,
      ...(next.axisPointer ?? {}),
      lineStyle: mergeLineStyle(defaults.axisPointer?.lineStyle, next.axisPointer?.lineStyle),
    },
  }
}

const buildOption = (option?: EChartsOption | null) => {
  const tokens = getThemeTokens()
  const axisDefaults = buildAxisDefaults(tokens)
  const tooltipDefaults = buildTooltipDefaults(tokens)
  const baseOption: EChartsOption = {
    color: [...GOOGLE_BRAND_COLORS],
    tooltip: tooltipDefaults,
  }
  const provided = option ?? {}
  const hasAxis = Boolean((provided as EChartsOption).xAxis || (provided as EChartsOption).yAxis)
  const merged: EChartsOption = {
    ...baseOption,
    ...provided,
    color: provided.color ?? baseOption.color,
    tooltip: mergeTooltip(tooltipDefaults, provided.tooltip),
  }
  if (hasAxis) {
    merged.grid =
      provided.grid ?? {
        left: 24,
        right: 24,
        top: 16,
        bottom: 24,
        containLabel: true,
      }
    if (provided.xAxis) merged.xAxis = mergeAxes(provided.xAxis, axisDefaults)
    if (provided.yAxis) merged.yAxis = mergeAxes(provided.yAxis, axisDefaults)
  }
  return merged
}

export const useECharts = (
  elRef: Ref<HTMLElement | null>,
  option: MaybeRef<EChartsOption | null> = null,
  initOptions: InitType = {},
) => {
  const chart = shallowRef<ECharts | null>(null)
  let resizeObserver: ResizeObserver | null = null
  let resizeRaf = 0

  const cleanupResize = () => {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf)
      resizeRaf = 0
    }
  }

  const dispose = () => {
    cleanupResize()
    if (chart.value) {
      chart.value.dispose()
      chart.value = null
    }
  }

  const resize = () => {
    if (!chart.value) return
    if (resizeRaf) cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(() => {
      chart.value?.resize()
    })
  }

  const attachResizeObserver = (el: HTMLElement) => {
    if (typeof ResizeObserver === 'undefined') return
    cleanupResize()
    resizeObserver = new ResizeObserver(() => resize())
    resizeObserver.observe(el)
  }

  const initChart = () => {
    const el = unref(elRef)
    if (!el) return
    if (chart.value && chart.value.getDom() === el) return
    if (chart.value) chart.value.dispose()
    chart.value = echarts.init(el, buildTheme(), initOptions)
    attachResizeObserver(el)
  }

  const setOption = (nextOption?: EChartsOption | null, opts: SetOptionOpts = {}) => {
    if (!chart.value) return
    chart.value.setOption(buildOption(nextOption), { notMerge: true, ...opts })
  }

  watch(
    () => unref(elRef),
    (el) => {
      if (!el) {
        dispose()
        return
      }
      nextTick(() => {
        initChart()
        setOption(unref(option))
      })
    },
    { immediate: true },
  )

  watch(
    () => unref(option),
    (nextOption) => {
      if (!chart.value) return
      setOption(nextOption)
    },
    { deep: true },
  )

  onBeforeUnmount(() => {
    dispose()
  })

  return {
    chart,
    setOption,
    resize,
    dispose,
    colors: GOOGLE_BRAND_COLORS,
  }
}
