<script setup lang="ts">
import { Fold, Expand, Refresh } from '@element-plus/icons-vue';

defineProps<{
  title: string;
  subtitle?: string;
  collapsed: boolean;
  syncing?: boolean;
}>();

defineEmits<{
  (e: 'toggleSidebar'): void;
  (e: 'sync'): void;
}>();
</script>

<template>
  <header class="header">
    <div class="left-section">
      <button class="toggle-btn" @click="$emit('toggleSidebar')">
        <el-icon><Fold v-if="!collapsed" /><Expand v-else /></el-icon>
      </button>
      
      <div class="titles">
        <h1 class="page-title">{{ title }}</h1>
        <span v-if="subtitle" class="page-subtitle">{{ subtitle }}</span>
      </div>
    </div>

    <div class="right-section">
      <slot name="actions">
        <!-- Default actions if not overridden -->
        <el-tooltip content="同步配额" placement="bottom">
          <el-button circle :loading="syncing" @click="$emit('sync')">
            <el-icon v-if="!syncing"><Refresh /></el-icon>
          </el-button>
        </el-tooltip>
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

/* Mobile responsive adjustments if needed can go here */
@media (max-width: 768px) {
  .header {
    padding: 0 var(--space-4);
  }
  
  .page-subtitle {
    display: none;
  }
}
</style>
