<script setup lang="ts">
import { ref } from 'vue'
import type { KeyRecord } from '../stores/keys'
import { Delete, RefreshLeft, VideoPause, VideoPlay, Edit } from '@element-plus/icons-vue'

defineProps<{
  keys: KeyRecord[]
  loading?: boolean
  provider?: string
  tests?: Record<number, { status: string; message: string }>
}>()

const emit = defineEmits<{
  (e: 'billing', id: number): void
  (e: 'test', id: number): void
  (e: 'enable', id: number): void
  (e: 'disable', id: number): void
  (e: 'reset', id: number): void
  (e: 'delete', id: number): void
  (e: 'updateWeight', id: number, weight: number): void
  (e: 'updateName', id: number, displayName: string): void
  (e: 'selection-change', selection: KeyRecord[]): void
}>()

const table = ref<any>()
defineExpose({ clearSelection: () => table.value?.clearSelection() })

// Inline editing state
const editingId = ref<number | null>(null)
const editingName = ref('')

const startEdit = (row: KeyRecord) => {
  editingId.value = row.id
  editingName.value = row.display_name || ''
}

const saveEdit = () => {
  if (editingId.value !== null) {
    emit('updateName', editingId.value, editingName.value.trim())
    editingId.value = null
    editingName.value = ''
  }
}

const cancelEdit = () => {
  editingId.value = null
  editingName.value = ''
}

const handleKeydown = (e: Event | KeyboardEvent) => {
  const event = e as KeyboardEvent
  if (event.key === 'Enter') {
    saveEdit()
  } else if (event.key === 'Escape') {
    cancelEdit()
  }
}

const statusType = (status: string) => {
  switch (status) {
    case 'active': return 'success'
    case 'disabled': return 'info'
    case 'quota_exceeded': return 'warning'
    case 'banned': return 'danger'
    default: return 'info'
  }
}

const quotaLimitLabel = (row: KeyRecord) => {
  if (row.provider === 'exa') return '按实际账单'
  if (row.quota?.quota_limit !== null && row.quota?.quota_limit !== undefined) {
    return row.quota.quota_limit
  }
  if (row.usage_sync?.last_status === 'pending' || row.usage_sync?.last_status === 'running' || row.usage_sync?.last_status === 'never') {
    return '待同步'
  }
  return '未知'
}

const syncStatusLabel = (row: KeyRecord) => {
  if (row.provider === 'exa') return 'Exa 不进行配额探测'
  switch (row.usage_sync?.last_status) {
    case 'pending': return '队列中'
    case 'running': return '同步中'
    case 'success': return row.usage_sync.last_success_at ? `已同步 ${new Date(row.usage_sync.last_success_at).toLocaleString()}` : '已同步'
    case 'rate_limited': return '等待限流恢复'
    case 'error': return row.usage_sync.last_error ? `同步失败：${row.usage_sync.last_error}` : '同步失败'
    default: return '尚未同步'
  }
}

const handleSelectionChange = (selection: KeyRecord[]) => {
  emit('selection-change', selection)
}
</script>

<template>
  <el-table ref="table" row-key="id" empty-text="还没有符合条件的密钥，添加一个开始使用" :data="keys" stripe v-loading="!!loading" style="width: 100%" @selection-change="handleSelectionChange">
    <el-table-column type="selection" width="44" /><el-table-column prop="id" label="ID" width="60"/>

    <el-table-column label="Key" width="150">
      <template #default="{ row }">
        <code class="key-preview">{{ row.key_preview }}</code>
      </template>
    </el-table-column>

    <el-table-column label="状态" width="112">
      <template #default="{ row }">
        <el-tag :type="statusType(row.status)" size="small" :title="row.last_error_message || ''">
          {{ ({ active: '可用', disabled: '已停用', quota_exceeded: '额度暂停', banned: '密钥失效' } as any)[row.status] || row.status }}
        </el-tag>
        <small v-if="tests?.[row.id]" class="key-test-result" :class="{ 'text-danger': tests[row.id].status==='error' }" :title="tests[row.id].message">{{ ({running:'测试中',queued:'等待测试',success:'测试通过',error:'测试失败'} as any)[tests[row.id].status] }}</small>
      </template>
    </el-table-column>

    <el-table-column label="备注" min-width="140">
      <template #default="{ row }">
        <!-- Editing mode -->
        <template v-if="editingId === row.id">
          <el-input
            v-model="editingName"
            size="small"
            placeholder="输入备注"
            @keydown="handleKeydown"
            @blur="saveEdit"
            autofocus
            class="name-input"
          />
        </template>
        <!-- Display mode -->
        <template v-else>
          <span
            class="key-name editable"
            @click="startEdit(row as KeyRecord)"
            :title="row.display_name ? '点击编辑' : '点击添加备注'"
          >
            {{ row.display_name || '点击添加...' }}
            <el-icon class="edit-icon"><Edit /></el-icon>
          </span>
        </template>
      </template>
    </el-table-column>

    <el-table-column label="成功 / 总请求" width="120">
      <template #default="{ row }">
        <div class="stats-col">
          <span class="success">{{ row.successful_requests }}</span> /
          <span class="total">{{ row.total_requests }}</span>
        </div>
      </template>
    </el-table-column>

    <el-table-column label="权重" width="118"><template #default="{ row }"><el-input-number :model-value="row.weight" :min="1" :max="100" size="small" controls-position="right" style="width:100px" @change="(value:number|undefined) => value && emit('updateWeight', row.id, value)" /></template></el-table-column>
    <el-table-column label="错误" width="65">
      <template #default="{ row }">
        <span :class="{ 'text-danger': row.error_count > 0 }">{{ row.error_count }}</span>
      </template>
    </el-table-column>

    <el-table-column :label="provider==='exa'?'费用 / USD':'当月配额'" min-width="190">
      <template #default="{ row }">
        <div v-if="row.provider==='exa'" class="quota-cell">
          <span>${{ (row.billing?.total_usd ?? 0).toFixed(4) }} <small>本月网关记录</small></span>
          <small v-if="row.billing?.estimated_usd">含估算 ${{ row.billing.estimated_usd.toFixed(4) }}</small>
          <small v-if="row.billing?.unsettled">{{ row.billing.unsettled }} 个任务费用待确认</small>
          <small v-if="row.quota_reset_at">恢复：{{ new Date(row.quota_reset_at).toLocaleDateString() }}</small>
        </div>
        <div v-else class="quota-cell" :title="syncStatusLabel(row as KeyRecord)">
          <span>{{ row.quota?.used_count ?? 0 }} / {{ quotaLimitLabel(row as KeyRecord) }}</span>
          <small>{{ syncStatusLabel(row as KeyRecord) }}</small>
        </div>
      </template>
    </el-table-column>

    <el-table-column label="操作" :width="provider==='exa'?228:180" fixed="right">
      <template #default="{ row }">
        <div class="action-buttons">
          <el-button link type="primary" :loading="['running','queued'].includes(tests?.[row.id]?.status || '')" :title="row.provider==='exa'?'单次 Lite 搜索，预计 $0.004；费用记入账本':'验证当前密钥并同步配额，不发起搜索'" @click="emit('test',row.id)">测试</el-button>
          <el-button v-if="row.provider==='exa'" link @click="emit('billing',row.id)">费用</el-button>
          <button
            class="action-btn" :title="row.status==='active'?'停用':'启用'" :aria-label="row.status==='active'?'停用密钥':'启用密钥'"
            :class="row.status === 'active' ? 'action-btn--warning' : 'action-btn--success'"
            @click="row.status === 'active' ? emit('disable', row.id) : emit('enable', row.id)"
          >
            <el-icon><VideoPause v-if="row.status === 'active'" /><VideoPlay v-else /></el-icon>
          </button>

          <button class="action-btn" title="重置错误计数" aria-label="重置错误计数" @click="emit('reset', row.id)">
            <el-icon><RefreshLeft /></el-icon>
          </button>

          <button title="删除密钥" aria-label="删除密钥" class="action-btn action-btn--danger" @click="emit('delete', row.id)">
            <el-icon><Delete /></el-icon>
          </button>
        </div>
      </template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
.key-test-result { display:block; margin-top:4px; color:var(--color-text-secondary); font-size:11px; }
.key-test-result.text-danger { color:var(--color-danger); }
.key-preview {
  font-family: monospace;
  background-color: var(--color-background);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.85em;
}

.key-name {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.key-name.editable {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.key-name.editable:hover {
  background-color: var(--color-background);
  color: var(--color-primary);
}

.edit-icon {
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.2s;
}

.key-name.editable:hover .edit-icon {
  opacity: 1;
}

.name-input {
  width: 100%;
  max-width: 160px;
}

.stats-col {
  font-family: monospace;
}

.quota-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  white-space: nowrap;
}

.quota-cell small {
  color: var(--color-text-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.success { color: var(--color-success); }
.total { color: var(--color-text-secondary); }
.text-danger { color: var(--color-danger); font-weight: bold; }

/* Action Buttons - Minimal Icon Style */
.action-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

.action-btn--success:hover {
  background: #f0f9ff;
  color: #0369a1;
}

.action-btn--warning:hover {
  background: #fffbeb;
  color: #b45309;
}

.action-btn--danger:hover {
  background: #fef2f2;
  color: #b91c1c;
}

.action-btn .el-icon {
  font-size: 16px;
}
</style>
