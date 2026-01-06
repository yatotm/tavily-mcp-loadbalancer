<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useKeysStore, type KeyRecord } from '../stores/keys'
import KeyTable from '../components/KeyTable.vue'
import AddKeyDialog from '../components/AddKeyDialog.vue'
import { useToast } from '../composables/useToast'
import { ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'

const keysStore = useKeysStore()
const loading = ref(false)
const showAddDialog = ref(false)
const addLoading = ref(false)
const batchActionLoading = ref(false)
const batchTestLoading = ref(false)
const selectedKeys = ref<KeyRecord[]>([])
const { success, error, info } = useToast()

const selectedIds = computed(() => selectedKeys.value.map((key) => key.id))
const hasSelection = computed(() => selectedIds.value.length > 0)

const fetchKeys = async () => {
  loading.value = true
  try {
    await keysStore.fetchKeys()
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to fetch API keys')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchKeys()
})

const handleEnable = async (id: number) => {
  try {
    await keysStore.enableKey(id)
    success('Key enabled')
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to enable key')
  }
}

const handleDisable = async (id: number) => {
  try {
    await keysStore.disableKey(id)
    success('Key disabled')
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to disable key')
  }
}

const handleReset = async (id: number) => {
  try {
    await keysStore.resetErrors(id)
    success('Error count reset')
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to reset errors')
  }
}

const handleDelete = async (id: number) => {
  try {
    await ElMessageBox.confirm(
      '确定要删除此 API Key 吗？此操作无法撤销。',
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    
    await keysStore.deleteKey(id)
    success('Key deleted')
  } catch (err) {
    if (err !== 'cancel') {
      error(err instanceof Error ? err.message : 'Failed to delete key')
    }
  }
}

const handleAddKeys = async (payload: { keys: string[] }) => {
  addLoading.value = true
  try {
    await keysStore.importKeys(payload.keys)
    await keysStore.fetchKeys()
    const count = payload.keys.length
    success(count > 1 ? `成功添加 ${count} 个 Key` : 'Key 添加成功')
    showAddDialog.value = false
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to add keys')
  } finally {
    addLoading.value = false
  }
}

const handleUpdateName = async (id: number, displayName: string) => {
  try {
    await keysStore.updateKey(id, { display_name: displayName })
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to update name')
  }
}

const handleSelectionChange = (selection: KeyRecord[]) => {
  selectedKeys.value = selection
}

const handleBatchEnable = async () => {
  if (!hasSelection.value) return
  const count = selectedIds.value.length
  batchActionLoading.value = true
  try {
    await keysStore.batchEnable(selectedIds.value)
    success(`已启用 ${count} 个 Key`)
  } catch (err) {
    error(err instanceof Error ? err.message : '批量启用失败')
  } finally {
    batchActionLoading.value = false
  }
}

const handleBatchDisable = async () => {
  if (!hasSelection.value) return
  const count = selectedIds.value.length
  batchActionLoading.value = true
  try {
    await keysStore.batchDisable(selectedIds.value)
    success(`已禁用 ${count} 个 Key`)
  } catch (err) {
    error(err instanceof Error ? err.message : '批量禁用失败')
  } finally {
    batchActionLoading.value = false
  }
}

const handleBatchTest = async () => {
  if (!hasSelection.value) return
  batchTestLoading.value = true
  try {
    const results = await keysStore.batchTest(selectedIds.value)
    const total = results.length
    const successCount = results.filter((item) => item.status === 'success').length
    const errorCount = total - successCount
    const authCount = results.filter((item) => item.error_type === 'auth').length
    const networkCount = results.filter((item) => item.error_type === 'network').length
    if (errorCount === 0) {
      success(`批量测试完成：${successCount}/${total} 成功`)
    } else {
      info(`批量测试完成：成功 ${successCount}，失败 ${errorCount}（认证 ${authCount} / 网络 ${networkCount}）`)
    }
  } catch (err) {
    error(err instanceof Error ? err.message : '批量测试失败')
  } finally {
    batchTestLoading.value = false
  }
}
</script>

<template>
  <div class="keys-view">
    <div class="view-header">
      <h2 class="view-title">API Key 管理</h2>
      <el-button type="primary" size="default" :icon="Plus" @click="showAddDialog = true">
        新增 Key
      </el-button>
    </div>

    <el-card shadow="never" class="table-card" :body-style="{ padding: 'var(--space-4)' }">
      <div class="toolbar">
        <div class="batch-actions" :class="{ 'visible': hasSelection }">
          <button
            class="batch-btn batch-btn--enable"
            :disabled="!hasSelection || batchTestLoading || batchActionLoading"
            @click="handleBatchEnable"
          >
            <span v-if="batchActionLoading" class="spinner"></span>
            <span v-else>启用</span>
          </button>
          <button
            class="batch-btn batch-btn--disable"
            :disabled="!hasSelection || batchTestLoading || batchActionLoading"
            @click="handleBatchDisable"
          >
            <span v-if="batchActionLoading" class="spinner"></span>
            <span v-else>禁用</span>
          </button>
          <button
            class="batch-btn batch-btn--test"
            :disabled="!hasSelection || batchActionLoading || batchTestLoading"
            @click="handleBatchTest"
          >
            <span v-if="batchTestLoading" class="spinner"></span>
            <span v-else>测试</span>
          </button>
          <span class="batch-count">{{ selectedIds.length }} 项已选</span>
        </div>
      </div>
      <KeyTable
        :keys="keysStore.keys"
        :loading="loading"
        @enable="handleEnable"
        @disable="handleDisable"
        @reset="handleReset"
        @delete="handleDelete"
        @update-name="handleUpdateName"
        @selection-change="handleSelectionChange"
      />
    </el-card>

    <AddKeyDialog
      v-model="showAddDialog"
      :loading="addLoading"
      @submit="handleAddKeys"
    />
  </div>
</template>

<style scoped>
.keys-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100%;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.view-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.table-card {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Toolbar - Fixed height to prevent layout shift */
.toolbar {
  height: 40px;
  margin-bottom: var(--space-3);
  display: flex;
  align-items: center;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0;
  transform: translateY(-4px);
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.batch-actions.visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

/* Batch Buttons - Text Link Style */
.batch-btn {
  padding: 6px 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #6b7280;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  height: 32px;
}

.batch-btn:hover:not(:disabled) {
  background: #f3f4f6;
  color: #374151;
}

.batch-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.batch-btn--enable:hover:not(:disabled) {
  background: #f0f9ff;
  color: #0369a1;
}

.batch-btn--disable:hover:not(:disabled) {
  background: #fffbeb;
  color: #b45309;
}

.batch-btn--test:hover:not(:disabled) {
  background: #eff6ff;
  color: #2563eb;
}

/* Spinner */
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #e5e7eb;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.batch-count {
  color: var(--color-text-secondary);
  font-size: 12px;
  padding-left: 8px;
  border-left: 1px solid #e5e7eb;
  margin-left: 4px;
}
</style>
