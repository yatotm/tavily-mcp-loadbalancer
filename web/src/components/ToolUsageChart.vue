<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolUsage } from '../stores/stats'
import { useECharts } from '../composables/useECharts'
import type { EChartsOption } from 'echarts'

const props = defineProps<{
  data: ToolUsage | null
  loading?: boolean
}>()

const chartRef = ref<HTMLElement | null>(null)

const defaultTools = ['search', 'extract', 'crawl', 'map']

const colorMap: Record<string, string> = {
  search: '#4285F4',
  extract: '#34A853',
  crawl: '#EA4335',
  map: '#FBBC05'
}

const chartOption = computed<EChartsOption>(() => {
  const rawData = props.data || {}
  const hasData = Object.keys(rawData).length > 0
  
  let sourceData: [string, number][] = []
  
  if (hasData) {
    sourceData = (Object.entries(rawData) as [string, number][])
      .sort((a, b) => b[1] - a[1])
  } else {
    sourceData = defaultTools.map(t => [t, 0])
  }

  const categories = sourceData.map(d => d[0])
  const values = sourceData.map(d => d[1])
  const total = values.reduce((sum, val) => sum + val, 0)

  return {
    title: {
      text: '工具使用分布'
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const item = Array.isArray(params) ? params[0] : params
        const val = item.value
        const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0'
        // Using item.marker for the color dot
        return `${item.name}<br/>${item.marker} ${val} (${pct}%)`
      }
    },
    xAxis: {
      type: 'value',
      minInterval: 1
    },
    yAxis: {
      type: 'category',
      data: categories,
      inverse: true, // Largest at top
      axisLabel: {
        formatter: (val: string) => val // Can capitalize if needed
      }
    },
    series: [
      {
        type: 'bar',
        data: values.map((val, index) => ({
          value: val,
          itemStyle: {
            color: colorMap[categories[index]] || '#9CA3AF', // Gray-400 as fallback
            borderRadius: [0, 4, 4, 0]
          }
        })),
        label: {
          show: true,
          position: 'right',
          formatter: '{c}'
        },
        barWidth: '60%'
      }
    ]
  }
})

useECharts(chartRef, chartOption)
</script>

<template>
  <div class="tool-usage-chart-container">
    <div v-if="loading" class="loading-container">
      <el-skeleton :rows="5" animated />
    </div>
    <div v-else ref="chartRef" class="chart"></div>
  </div>
</template>

<style scoped>
.tool-usage-chart-container {
  width: 100%;
  height: 300px; /* Base height */
  position: relative;
}

.loading-container {
  padding: 20px;
}

.chart {
  width: 100%;
  height: 100%;
}
</style>
