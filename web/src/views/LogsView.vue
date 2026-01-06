<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { useApi } from '../composables/useApi'
import LogTable, { type LogEntry } from '../components/LogTable.vue'
import { useToast } from '../composables/useToast'
import { ElMessageBox } from 'element-plus'
import { Search, Delete } from '@element-plus/icons-vue'

interface ApiLogEntry {
  id: number
  created_at: string
  tool_name: string
  key_id: number | null
  response_status: string
  response_time_ms: number | null
  error_message: string | null
}

interface LogDetail {
  id: number
  key_id: number | null
  tool_name: string
  request_params: string | null
  response_data: string | null
  response_status: string
  response_time_ms: number | null
  error_type: string | null
  error_message: string | null
  created_at: string
}

const api = useApi()
const loading = ref(false)
const logs = ref<LogEntry[]>([])
const total = ref(0)
const { success, error } = useToast()

// Detail dialog
const showDetailDialog = ref(false)
const detailLoading = ref(false)
const logDetail = ref<LogDetail | null>(null)

const filters = reactive({
  keyword: '',
  status: 'all' as 'all' | 'success' | 'error',
  page: 1,
  pageSize: 20
})

const fetchLogs = async () => {
  loading.value = true
  try {
    const queryParams = new URLSearchParams()
    queryParams.append('page', filters.page.toString())
    queryParams.append('limit', filters.pageSize.toString())

    if (filters.keyword) queryParams.append('keyword', filters.keyword)
    if (filters.status !== 'all') queryParams.append('status', filters.status)

    const data = await api.get<{ logs: ApiLogEntry[], total: number }>(`/api/logs?${queryParams.toString()}`)
    logs.value = (data.logs || []).map((log) => ({
      id: log.id,
      timestamp: log.created_at,
      tool: log.tool_name,
      key_id: log.key_id ?? undefined,
      status: log.response_status,
      duration_ms: log.response_time_ms ?? null,
      error_message: log.error_message ?? undefined,
    }))
    total.value = data.total || 0
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to fetch logs')
    console.error(err)
  } finally {
    loading.value = false
  }
}

const handleFilter = () => {
  filters.page = 1
  fetchLogs()
}

const handleClearLogs = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要清除30天前的日志吗？此操作无法撤销。',
      '确认清除',
      {
        confirmButtonText: '清除日志',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await api.delete('/api/logs?days=30')
    success('Old logs cleared')
    fetchLogs()
  } catch (err) {
    if (err !== 'cancel') {
      error(err instanceof Error ? err.message : 'Failed to clear logs')
    }
  }
}

const handleRowClick = async (log: LogEntry) => {
  showDetailDialog.value = true
  detailLoading.value = true
  logDetail.value = null

  try {
    const detail = await api.get<LogDetail>(`/api/logs/${log.id}`)
    logDetail.value = detail
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to fetch log detail')
    showDetailDialog.value = false
  } finally {
    detailLoading.value = false
  }
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString()
}

const formatJson = (jsonStr: string | null): string => {
  if (!jsonStr) return '-'
  try {
    const parsed = JSON.parse(jsonStr)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return jsonStr
  }
}

watch(() => [filters.page, filters.pageSize], () => {
  fetchLogs()
})

onMounted(() => {
  fetchLogs()
})
</script>

<template>
  <div class="logs-view">
    <div class="view-header">
      <h2 class="view-title">请求日志</h2>
    </div>

    <div class="filters-bar">
      <div class="left-filters">
        <el-input
          v-model="filters.keyword"
          placeholder="搜索日志..."
          :prefix-icon="Search"
          style="width: 300px"
          @keyup.enter="handleFilter"
          clearable
          @clear="handleFilter"
        />

        <el-select v-model="filters.status" placeholder="选择状态" style="width: 150px" @change="handleFilter">
          <el-option label="全部" value="all" />
          <el-option label="成功" value="success" />
          <el-option label="失败" value="error" />
        </el-select>

        <el-button type="primary" size="default" @click="handleFilter">筛选</el-button>
      </div>

      <div class="right-actions">
        <el-button type="danger" size="default" :icon="Delete" plain @click="handleClearLogs">
          删除旧日志
        </el-button>
      </div>
    </div>

    <el-card shadow="never" class="table-card" :body-style="{ padding: 'var(--space-4)' }">
      <LogTable
        :logs="logs"
        :total="total"
        v-model:page="filters.page"
        v-model:pageSize="filters.pageSize"
        :loading="loading"
        @row-click="handleRowClick"
      />
    </el-card>

    <!-- Detail Dialog -->
    <el-dialog
      v-model="showDetailDialog"
      title="请求详情"
      width="700px"
      align-center
      :close-on-click-modal="true"
    >
      <div v-loading="detailLoading">
        <template v-if="logDetail">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="ID">{{ logDetail.id }}</el-descriptions-item>
            <el-descriptions-item label="Key ID">{{ logDetail.key_id || '-' }}</el-descriptions-item>
            <el-descriptions-item label="工具">
              <el-tag size="small">{{ logDetail.tool_name }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="logDetail.response_status === 'success' ? 'success' : 'danger'" size="small">
                {{ logDetail.response_status }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="时间">{{ formatDate(logDetail.created_at) }}</el-descriptions-item>
            <el-descriptions-item label="耗时">
              {{ logDetail.response_time_ms !== null ? `${logDetail.response_time_ms}ms` : '-' }}
            </el-descriptions-item>
            <el-descriptions-item v-if="logDetail.error_type" label="错误类型" :span="2">
              <span class="error-text">{{ logDetail.error_type }}</span>
            </el-descriptions-item>
            <el-descriptions-item v-if="logDetail.error_message" label="错误信息" :span="2">
              <span class="error-text">{{ logDetail.error_message }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <div class="params-section" v-if="logDetail.request_params">
            <h4>请求参数</h4>
            <pre class="json-block">{{ formatJson(logDetail.request_params) }}</pre>
          </div>

          <div class="params-section" v-if="logDetail.response_data">
            <h4>响应数据</h4>
            <pre class="json-block response-block">{{ formatJson(logDetail.response_data) }}</pre>
          </div>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.logs-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100%;
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

.filters-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  background-color: var(--color-surface);
  padding: var(--space-3);
  border-radius: var(--radius-base);
  border: 1px solid var(--color-border);
}

.left-filters {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
}

.table-card {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.params-section {
  margin-top: var(--space-4);
}

.params-section h4 {
  margin: 0 0 var(--space-2) 0;
  font-size: 0.95rem;
  color: var(--color-text-primary);
}

.json-block {
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  padding: var(--space-3);
  margin: 0;
  font-family: monospace;
  font-size: 0.85rem;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.json-block.response-block {
  max-height: 350px;
  background-color: #f8fdf8;
  border-color: var(--color-success);
}

.error-text {
  color: var(--color-danger);
}
</style>
