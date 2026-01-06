<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useKeysStore } from '../stores/keys'
import KeyTable from '../components/KeyTable.vue'
import AddKeyDialog from '../components/AddKeyDialog.vue'
import { useToast } from '../composables/useToast'
import { ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'

const keysStore = useKeysStore()
const loading = ref(false)
const showAddDialog = ref(false)
const addLoading = ref(false)
const { success, error } = useToast()

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
      <KeyTable
        :keys="keysStore.keys"
        :loading="loading"
        @enable="handleEnable"
        @disable="handleDisable"
        @reset="handleReset"
        @delete="handleDelete"
        @update-name="handleUpdateName"
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
</style>
