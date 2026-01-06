<script setup lang="ts">
export interface LogEntry {
  id: number
  timestamp: string
  tool: string
  key_id?: number
  status: string
  duration_ms: number | null
  error_message?: string
}

const props = defineProps<{
  logs: LogEntry[]
  loading?: boolean
  total: number
  page: number
  pageSize: number
}>()

const emit = defineEmits<{
  (e: 'update:page', page: number): void
  (e: 'update:pageSize', size: number): void
  (e: 'rowClick', log: LogEntry): void
}>()

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString()
}

const statusType = (status: string) => {
  return status === 'success' ? 'success' : 'danger'
}

const handleRowClick = (row: LogEntry) => {
  emit('rowClick', row)
}
</script>

<template>
  <div class="log-table-container">
    <el-table
      :data="logs"
      v-loading="!!loading"
      stripe
      style="width: 100%"
      @row-click="handleRowClick"
      row-class-name="clickable-row"
    >
      <el-table-column label="时间" min-width="160">
        <template #default="{ row }">
          {{ formatDate(row.timestamp) }}
        </template>
      </el-table-column>

      <el-table-column prop="tool" label="工具" width="100">
        <template #default="{ row }">
          <el-tag size="small">{{ row.tool }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="Key ID" width="80">
        <template #default="{ row }">
          <span class="monospace">{{ row.key_id || '-' }}</span>
        </template>
      </el-table-column>

      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="耗时" width="100">
        <template #default="{ row }">
          <span v-if="row.duration_ms !== null">{{ row.duration_ms }}ms</span>
          <span v-else class="text-secondary">-</span>
        </template>
      </el-table-column>

      <el-table-column label="错误信息" min-width="200">
        <template #default="{ row }">
          <span v-if="row.error_message" class="error-msg" :title="row.error_message">
            {{ row.error_message }}
          </span>
          <span v-else class="text-secondary">-</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="props.page"
        v-model:page-size="props.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        :total="total"
        @size-change="emit('update:pageSize', $event)"
        @current-change="emit('update:page', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.pagination-wrapper {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
}

.monospace {
  font-family: monospace;
}

.error-msg {
  color: var(--color-danger);
  font-size: 0.9em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.text-secondary {
  color: var(--color-text-secondary);
}

:deep(.clickable-row) {
  cursor: pointer;
}

:deep(.clickable-row:hover) {
  background-color: var(--el-table-row-hover-bg-color) !important;
}
</style>
