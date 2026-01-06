<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useStatsStore, type StatsOverview, type ToolUsage, type TimelineData } from '../stores/stats'
import StatCard from '../components/StatCard.vue'
import ToolUsageChart from '../components/ToolUsageChart.vue'
import TimelineChart from '../components/TimelineChart.vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'

const statsStore = useStatsStore()
const api = useApi()
const { error } = useToast()
const loading = ref(false)

const formatUptime = (seconds: number) => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const fetchData = async () => {
  loading.value = true
  try {
    const data = await api.get<StatsOverview>('/api/stats/overview')
    statsStore.updateFromApi({ overview: data })

    const toolsData = await api.get<{ tools: ToolUsage }>('/api/stats/tools')
    statsStore.updateFromApi({ tools: toolsData.tools })
    
    const timelineData = await api.get<{ timeline: TimelineData }>('/api/stats/timeline')
    statsStore.updateFromApi({ timeline: timelineData.timeline })
  } catch (err) {
    console.error('Failed to fetch stats:', err)
    error(err instanceof Error ? err.message : 'Failed to load dashboard data')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchData()
})

const overview = computed(() => statsStore.overview)
const tools = computed(() => statsStore.tools)
const timeline = computed(() => statsStore.timeline)
const keysSummary = computed(() => statsStore.overview?.keys ?? null)

const connectionStatus = computed(() => {
  const system = overview.value?.system
  if (!system) return null
  return system.ws_connections > 0 || system.sse_connections > 0 ? 'online' : 'offline'
})

const successRate = computed(() => {
  if (!overview.value) return null
  return overview.value.requests.success_rate
})

const quotaUsed = computed(() => {
  if (!overview.value) return 0
  return overview.value.quota.used
})

const quotaRemaining = computed(() => {
  if (!overview.value) return null
  return overview.value.quota.remaining
})

const quotaLimit = computed(() => {
  if (!overview.value) return null
  return overview.value.quota.limit
})
</script>

<template>
  <div class="dashboard-view">
    <!-- Stat Cards Row -->
    <div class="stats-grid">
      <StatCard
        label="系统运行时间"
        :value="overview ? formatUptime(overview.system.uptime) : '-'"
        :meta="overview ? (connectionStatus === 'online' ? '已连接' : '无连接') : '-'"
        :indicator="connectionStatus || undefined"
        type="primary"
        :loading="loading"
      />
      <StatCard
        label="总请求数"
        :value="overview ? overview.requests.total.toLocaleString() : '-'"
        :meta="successRate !== null ? `成功率: ${successRate.toFixed(1)}%` : '-'"
        type="success"
        :loading="loading"
      />
      <StatCard
        label="平均响应时间"
        :value="overview ? `${overview.requests.avg_response_time_ms}ms` : '-'"
        :meta="overview ? '延迟' : '-'"
        type="warning"
        :loading="loading"
      />
      <!-- 月度配额 - 自定义显示 -->
      <el-card shadow="hover" class="stat-card quota-card" :body-style="{ padding: 'var(--space-4)' }">
        <div class="stat-content">
          <div class="stat-label">月度配额</div>
          <el-skeleton v-if="loading" :rows="1" animated />
          <div v-else class="quota-tags">
            <el-tag type="danger" effect="dark" size="large">
              已用 {{ quotaUsed.toLocaleString() }}
            </el-tag>
            <el-tag type="success" effect="dark" size="large">
              可用 {{ quotaRemaining === null ? '∞' : quotaRemaining.toLocaleString() }}
            </el-tag>
          </div>
          <div v-if="!loading" class="stat-meta">
            {{ quotaLimit ? `限额: ${quotaLimit.toLocaleString()}` : '无限制' }}
          </div>
        </div>
      </el-card>
    </div>

    <div class="charts-grid">
      <!-- Key Summary Panel -->
      <el-card
        class="key-summary-card"
        shadow="hover"
        :body-style="{ padding: 'var(--space-4)' }"
        v-loading="loading"
      >
        <template #header>
          <div class="card-header">
            <span>Key 概览</span>
          </div>
        </template>
        <div v-if="keysSummary" class="key-stats-list">
          <div class="key-stat-item">
            <span class="label">总数</span>
            <span class="value">{{ keysSummary.total }}</span>
          </div>
          <div class="key-stat-item">
            <span class="label success">活跃</span>
            <span class="value">{{ keysSummary.active }}</span>
          </div>
          <div class="key-stat-item">
            <span class="label info">已禁用</span>
            <span class="value">{{ keysSummary.disabled }}</span>
          </div>
          <div class="key-stat-item">
            <span class="label warning">超额</span>
            <span class="value">{{ keysSummary.quota_exceeded }}</span>
          </div>
          <div class="key-stat-item">
            <span class="label danger">封禁</span>
            <span class="value">{{ keysSummary.banned }}</span>
          </div>
        </div>
        <el-skeleton v-else :rows="3" />
      </el-card>

      <!-- Tool Usage -->
      <el-card
        class="tool-usage-card"
        shadow="hover"
        :body-style="{ padding: 'var(--space-6)' }"
        v-loading="loading"
      >
        <ToolUsageChart :data="tools" :loading="loading" />
      </el-card>
    </div>

    <!-- Timeline -->
    <el-card
      class="timeline-card"
      shadow="hover"
      :body-style="{ padding: 'var(--space-6)' }"
      v-loading="loading"
    >
      <TimelineChart :data="timeline" :loading="loading" />
    </el-card>
  </div>
</template>

<style scoped>
.dashboard-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-4);
}

.charts-grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: var(--space-4);
}

@media (max-width: 768px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }
}

.timeline-card {
  margin-bottom: var(--space-4);
}

.key-stats-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.key-stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-md);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-background);
}

.key-stat-item:last-child {
  border-bottom: none;
}

.key-stat-item .label.success { color: var(--color-success); }
.key-stat-item .label.info { color: var(--color-text-secondary); }
.key-stat-item .label.warning { color: var(--color-warning); }
.key-stat-item .label.danger { color: var(--color-danger); }
.key-stat-item .value { font-weight: bold; }

/* 月度配额卡片样式 */
.quota-card .stat-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--space-2);
  font-weight: 500;
}

.quota-tags {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.quota-card .stat-meta {
  margin-top: var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
</style>
