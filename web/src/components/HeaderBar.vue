<script setup lang="ts">
import { Fold, Expand, Refresh, ArrowDown } from '@element-plus/icons-vue';

defineProps<{
  title: string;
  subtitle?: string;
  collapsed: boolean;
  syncing?: boolean;
  canLogout?: boolean;
  syncStatus?: {
    pending: number;
    running: number;
    blockedUntil: string | null;
  } | null;
}>();

const emit = defineEmits<{
  (e: 'toggleSidebar'): void;
  (e: 'syncStale'): void;
  (e: 'syncAll'): void;
  (e: 'logout'): void;
}>();
const sync = (command: string) => command === 'all' ? emit('syncAll') : emit('syncStale');
</script>

<template>
  <header class="header">
    <div class="left-section">
      <button aria-label="切换侧边栏" class="toggle-btn" @click="$emit('toggleSidebar')">
        <el-icon><Fold v-if="!collapsed" /><Expand v-else /></el-icon>
      </button>
      
      <div class="titles">
        <h1 class="page-title">{{ title }}</h1>
        <span v-if="subtitle" class="page-subtitle">{{ subtitle }}</span>
      </div>
    </div>

    <div class="right-section">
      <slot name="actions">
        <button v-if="canLogout" class="quiet-button" @click="$emit('logout')">退出</button>
        <span v-if="syncStatus && (syncStatus.pending > 0 || syncStatus.running > 0)" class="queue-status">
          配额队列 {{ syncStatus.pending }} 等待<span v-if="syncStatus.running"> / 1 执行</span>
        </span>
        <el-dropdown :disabled="syncing" @command="sync">
          <el-button :loading="syncing" :icon="Refresh">同步配额<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
          <template #dropdown><el-dropdown-menu>
            <el-dropdown-item command="stale">同步过期 Tavily 密钥</el-dropdown-item>
            <el-dropdown-item command="all">同步全部 Tavily 密钥</el-dropdown-item>
          </el-dropdown-menu></template>
        </el-dropdown>
      </slot>
    </div>
  </header>
</template>

<style scoped>
.header {
  height: var(--header-height);
  background-color: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-6);
  position: sticky;
  top: 0;
  z-index: 10;
}

.left-section {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.toggle-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 1.25rem;
  display: flex;
  align-items: center;
  padding: var(--space-1);
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast), background-color var(--transition-fast);
}

.toggle-btn:hover {
  color: var(--color-primary);
  background-color: var(--color-background);
}

.titles {
  display: flex;
  flex-direction: column;
}

.page-title {
  font-size: var(--font-size-lg);
  margin: 0;
  line-height: 1.2;
}

.page-subtitle {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.right-section {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.queue-status {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

/* Mobile responsive adjustments if needed can go here */
@media (max-width: 768px) {
  .header {
    padding: 0 var(--space-4);
  }
  
  .page-subtitle {
    display: none;
  }

  .queue-status {
    display: none;
  }
}

/* Sync button - native button with custom spinner */
.sync-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.sync-btn:hover:not(:disabled) {
  color: var(--color-primary);
  border-color: var(--color-primary);
}

.sync-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.sync-btn .el-icon {
  font-size: 16px;
}

/* Custom spinner - guaranteed centered */
.sync-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #e5e7eb;
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: sync-spin 0.6s linear infinite;
}

@keyframes sync-spin {
  to { transform: rotate(360deg); }
}
</style>
