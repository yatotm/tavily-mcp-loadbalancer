<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useStatsStore, type ToolUsage, type KeyStatsSummary } from '../stores/stats'
import ToolUsageChart from '../components/ToolUsageChart.vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'

const statsStore = useStatsStore()
const api = useApi()
const { error } = useToast()
const loading = ref(false)

const fetchData = async () => {
  loading.value = true
  try {
    const toolsData = await api.get<{ tools: ToolUsage }>('/api/stats/tools')
    const keysData = await api.get<{ keys: KeyStatsSummary[] }>('/api/stats/keys')
    const normalizedKeys = (keysData.keys || []).map((key) => ({
      ...key,
      quota: key.quota
        ? {
            ...key.quota,
            remaining:
              key.quota.remaining ??
              (key.quota.quota_limit !== null
                ? Math.max(0, key.quota.quota_limit - key.quota.used_count)
                : null),
          }
        : null,
    }))
    statsStore.updateFromApi({ tools: toolsData.tools, keys: normalizedKeys })
  } catch (err) {
    console.error('Failed to fetch stats:', err)
    error(err instanceof Error ? err.message : 'Failed to load statistics')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchData()
})

const tools = computed(() => statsStore.tools)
const keyStats = computed(() => statsStore.keysSummary)

const statusType = (status: string) => {
  switch (status) {
    case 'active':
      return 'success'
    case 'quota_exceeded':
      return 'warning'
    case 'banned':
      return 'danger'
    case 'disabled':
    default:
      return 'info'
  }
}

const quotaPercentage = (quota: KeyStatsSummary['quota']) => {
  if (!quota || !quota.quota_limit) return 0
  return Math.min(100, Math.round((quota.used_count / quota.quota_limit) * 100))
}

const quotaStatus = (quota: KeyStatsSummary['quota']) => {
  if (!quota || !quota.quota_limit) return ''
  const remaining = Math.max(0, quota.quota_limit - quota.used_count)
  return remaining === 0 ? 'exception' : ''
}
</script>

<template>
  <div class="stats-view">
    <div class="view-header">
      <h2 class="view-title">使用统计</h2>
    </div>

    <div class="stats-content">
      <el-card
        shadow="hover"
        class="chart-card"
        :body-style="{ padding: 'var(--space-6)' }"
        v-loading="loading"
      >
        <ToolUsageChart :data="tools" :loading="loading" />
      </el-card>

      <el-card shadow="hover" class="table-card" :body-style="{ padding: 'var(--space-4)' }">
        <template #header>
          <div class="card-header">
            <span>单 Key 统计</span>
          </div>
        </template>
        
        <el-table :data="keyStats" stripe v-loading="loading" style="width: 100%">
          <el-table-column label="Key" min-width="150">
            <template #default="{ row }">
              <code class="key-preview">{{ row.key_preview }}</code>
              <span class="key-name" v-if="row.display_name"> ({{ row.display_name }})</span>
            </template>
          </el-table-column>

          <el-table-column prop="status" label="状态" width="130">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)" size="small">
                {{ row.status }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="success" label="成功次数" width="140" />
          <el-table-column prop="failed" label="失败次数" width="140">
            <template #default="{ row }">
              <span :class="{ 'text-danger': row.failed > 0 }">{{ row.failed }}</span>
            </template>
          </el-table-column>

          <el-table-column label="配额进度" min-width="220">
            <template #default="{ row }">
              <div v-if="row.quota" class="quota-cell">
                <el-progress
                  :percentage="quotaPercentage(row.quota)"
                  :status="quotaStatus(row.quota)"
                  :show-text="false"
                  class="quota-progress"
                />
                <span class="quota-text">
                  {{ row.quota.used_count }}/{{ row.quota.quota_limit || '∞' }}
                </span>
              </div>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.stats-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.view-header {
  margin-bottom: var(--space-2);
}

.view-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.stats-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.key-preview {
  font-family: monospace;
  background-color: var(--color-background);
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 0.85em;
}

.key-name {
  color: var(--color-text-secondary);
  font-size: 0.9em;
}

.text-danger {
  color: var(--color-danger);
  font-weight: bold;
}

.quota-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quota-progress {
  flex: 1;
  min-width: 80px;
  max-width: 120px;
}

.quota-text {
  font-size: 0.85em;
  color: var(--color-text-secondary);
  white-space: nowrap;
  min-width: 70px;
}
</style>
