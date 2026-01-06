<script setup lang="ts">
import { ref } from 'vue'
import type { KeyRecord } from '../stores/keys'
import { Delete, RefreshLeft, VideoPause, VideoPlay, Edit } from '@element-plus/icons-vue'

defineProps<{
  keys: KeyRecord[]
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'enable', id: number): void
  (e: 'disable', id: number): void
  (e: 'reset', id: number): void
  (e: 'delete', id: number): void
  (e: 'updateName', id: number, displayName: string): void
  (e: 'selection-change', selection: KeyRecord[]): void
}>()

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

const handleSelectionChange = (selection: KeyRecord[]) => {
  emit('selection-change', selection)
}
</script>

<template>
  <el-table :data="keys" stripe v-loading="!!loading" style="width: 100%" @selection-change="handleSelectionChange">
    <el-table-column type="selection" width="48" />

    <el-table-column label="Key" width="150">
      <template #default="{ row }">
        <code class="key-preview">{{ row.key_preview }}</code>
      </template>
    </el-table-column>

    <el-table-column label="状态" width="130">
      <template #default="{ row }">
        <el-tag :type="statusType(row.status)" size="small">
          {{ row.status }}
        </el-tag>
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
            @click="startEdit(row)"
            :title="row.display_name ? '点击编辑' : '点击添加备注'"
          >
            {{ row.display_name || '点击添加...' }}
            <el-icon class="edit-icon"><Edit /></el-icon>
          </span>
        </template>
      </template>
    </el-table-column>

    <el-table-column label="请求" min-width="140">
      <template #default="{ row }">
        <div class="stats-col">
          <span class="success">{{ row.successful_requests }}</span> /
          <span class="total">{{ row.total_requests }}</span>
        </div>
      </template>
    </el-table-column>

    <el-table-column label="错误" width="80">
      <template #default="{ row }">
        <span :class="{ 'text-danger': row.error_count > 0 }">{{ row.error_count }}</span>
      </template>
    </el-table-column>

    <el-table-column label="配额" width="100">
      <template #default="{ row }">
        <span v-if="row.quota">
           {{ row.quota.used_count }} / {{ row.quota.quota_limit !== null ? row.quota.quota_limit : '∞' }}
        </span>
        <span v-else>-</span>
      </template>
    </el-table-column>

    <el-table-column label="操作" width="140" fixed="right">
      <template #default="{ row }">
        <div class="action-buttons">
          <button
            class="action-btn"
            :class="row.status === 'active' ? 'action-btn--warning' : 'action-btn--success'"
            @click="row.status === 'active' ? emit('disable', row.id) : emit('enable', row.id)"
          >
            <el-icon><VideoPause v-if="row.status === 'active'" /><VideoPlay v-else /></el-icon>
          </button>

          <button class="action-btn" @click="emit('reset', row.id)">
            <el-icon><RefreshLeft /></el-icon>
          </button>

          <button class="action-btn action-btn--danger" @click="emit('delete', row.id)">
            <el-icon><Delete /></el-icon>
          </button>
        </div>
      </template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
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
