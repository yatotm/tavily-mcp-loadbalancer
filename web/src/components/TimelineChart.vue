<script setup lang="ts">
import { ref, computed } from 'vue'
import type { TimelineData } from '../stores/stats'
import { useECharts } from '../composables/useECharts'
import type { EChartsOption } from 'echarts'

const props = defineProps<{
  data: TimelineData | null
  loading?: boolean
}>()

// Generate past 30 days date sequence
const generateLast30Days = () => {
  const dates: string[] = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0])
  }
  return dates
}

// Fill data to ensure full 30 days coverage
const chartData = computed(() => {
  const dates = generateLast30Days()
  return dates.map(date => {
    // Format: 12/25
    const dateObj = new Date(date)
    const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`
    
    return {
      date, // ISO string for lookup if needed
      displayDate: formattedDate,
      count: props.data?.[date] ?? 0
    }
  })
})

const chartRef = ref<HTMLElement | null>(null)

const option = computed<EChartsOption>(() => {
  return {
    title: {
      text: '30天请求趋势',
      left: 0,
      textStyle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#1f2937'
      }
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const item = params[0]
        return `${item.name}<br/>请求数: ${item.value}`
      }
    },
    grid: {
      left: 0,
      right: 0,
      bottom: 0,
      top: 40,
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: chartData.value.map(item => item.displayDate),
      axisLabel: {
        rotate: -45,
        interval: 'auto',
        color: '#6b7280',
        fontSize: 10
      },
      axisLine: {
        lineStyle: {
          color: '#e5e7eb'
        }
      },
      axisTick: {
        show: false
      }
    },
    yAxis: {
      type: 'value',
      splitLine: {
        lineStyle: {
          color: '#f3f4f6'
        }
      },
      axisLabel: {
        color: '#6b7280',
        fontSize: 10
      }
    },
    series: [
      {
        name: 'Requests',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: chartData.value.map(item => item.count),
        itemStyle: {
          color: '#3b82f6'
        },
        areaStyle: {
          opacity: 0.15
        }
      }
    ]
  }
})

useECharts(chartRef, option)
</script>

<template>
  <div class="timeline-chart">
    <div v-if="loading" class="loading-state">
      <el-skeleton :rows="4" animated />
    </div>
    
    <div ref="chartRef" class="chart-container" :style="{ opacity: loading ? 0 : 1 }"></div>
  </div>
</template>

<style scoped>
.timeline-chart {
  position: relative;
  width: 100%;
}

.chart-container {
  width: 100%;
  height: 220px;
  transition: opacity 0.3s;
}

.loading-state {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.8);
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
</style>