<script setup lang="ts">
import { defineProps } from 'vue'

defineProps<{
  label: string
  value: string | number
  meta?: string
  subValue?: string
  loading?: boolean
  type?: 'primary' | 'success' | 'warning' | 'danger'
  indicator?: 'online' | 'offline' | 'warning'
}>()
</script>

<template>
  <el-card shadow="hover" class="stat-card" :body-style="{ padding: 'var(--space-4)' }">
    <div class="stat-content">
      <div class="stat-label">{{ label }}</div>
      <div class="stat-value-wrapper">
        <el-skeleton v-if="loading" :rows="1" animated />
        <div v-else class="stat-value" :class="type">
          {{ value }}
        </div>
      </div>
      <div v-if="(meta || subValue) && !loading" class="stat-meta">
        <span v-if="indicator" class="status-indicator" :class="indicator"></span>
        {{ meta || subValue }}
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.stat-card {
  height: 100%;
  border-radius: var(--radius-base);
  border: 1px solid var(--color-border);
}

.stat-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--space-2);
  font-weight: var(--font-weight-medium);
}

.stat-value {
  font-size: 1.75rem;
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  line-height: 1.2;
}

.stat-value.primary { color: var(--color-primary); }
.stat-value.success { color: var(--color-success); }
.stat-value.warning { color: var(--color-warning); }
.stat-value.danger { color: var(--color-danger); }

.stat-meta {
  margin-top: var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background-color: var(--color-text-secondary);
  display: inline-block;
}

.status-indicator.online { background-color: var(--color-success); }
.status-indicator.offline { background-color: var(--color-danger); }
.status-indicator.warning { background-color: var(--color-warning); }
</style>
