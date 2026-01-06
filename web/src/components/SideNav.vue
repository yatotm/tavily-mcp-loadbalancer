<script setup lang="ts">
import { computed } from 'vue';
import { 
  Odometer, 
  Key, 
  TrendCharts, 
  Document, 
  Setting, 
  Connection 
} from '@element-plus/icons-vue';

const props = defineProps<{
  currentView: string;
  collapsed: boolean;
  connectionStatus?: 'connected' | 'disconnected' | 'connecting';
}>();

const emit = defineEmits<{
  (e: 'update:currentView', view: string): void;
}>();

const navItems = [
  { id: 'dashboard', label: '仪表盘', icon: Odometer },
  { id: 'keys', label: 'API Key 管理', icon: Key },
  { id: 'stats', label: '使用统计', icon: TrendCharts },
  { id: 'logs', label: '请求日志', icon: Document },
  { id: 'settings', label: '系统设置', icon: Setting },
];

const connectionText = computed(() => {
  if (props.collapsed) return '';
  switch (props.connectionStatus) {
    case 'connected': return '已连接';
    case 'disconnected': return '未连接';
    case 'connecting': return '连接中...';
    default: return 'Unknown';
  }
});

const connectionColor = computed(() => {
  switch (props.connectionStatus) {
    case 'connected': return 'var(--color-success)';
    case 'disconnected': return 'var(--color-danger)';
    case 'connecting': return 'var(--color-warning)';
    default: return 'var(--color-text-secondary)';
  }
});
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="brand">
      <div class="logo-placeholder">T</div>
      <span v-if="!collapsed" class="brand-name">Tavily LB</span>
    </div>

    <nav class="nav-menu">
      <a 
        v-for="item in navItems" 
        :key="item.id"
        href="#"
        class="nav-item"
        :class="{ active: currentView === item.id }"
        @click.prevent="emit('update:currentView', item.id)"
        :title="collapsed ? item.label : ''"
      >
        <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
        <span v-if="!collapsed" class="nav-label">{{ item.label }}</span>
      </a>
    </nav>

    <div class="footer">
      <div class="connection-status" :title="!collapsed ? '' : connectionText">
        <el-icon :color="connectionColor"><Connection /></el-icon>
        <span v-if="!collapsed" :style="{ color: connectionColor }">{{ connectionText }}</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  background-color: var(--color-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  height: 100%;
  transition: width var(--transition-base);
  flex-shrink: 0;
}

.sidebar.collapsed {
  width: var(--sidebar-collapsed-width);
}

.brand {
  height: var(--header-height);
  display: flex;
  align-items: center;
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.logo-placeholder {
  width: 32px;
  height: 32px;
  background-color: var(--color-accent);
  color: white;
  border-radius: var(--radius-base);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  flex-shrink: 0;
}

.brand-name {
  margin-left: var(--space-3);
  font-weight: var(--font-weight-bold);
  font-size: var(--font-size-lg);
  color: var(--color-primary);
  white-space: nowrap;
  overflow: hidden;
}

.nav-menu {
  flex: 1;
  padding: var(--space-4) var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-base);
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: all var(--transition-fast);
  white-space: nowrap;
  overflow: hidden;
}

.nav-item:hover {
  background-color: var(--color-background);
  color: var(--color-primary);
}

.nav-item.active {
  background-color: rgba(59, 130, 246, 0.1); /* transparent accent */
  color: var(--color-accent);
  font-weight: var(--font-weight-medium);
}

.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: var(--space-3) 0;
}

.nav-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.nav-label {
  margin-left: var(--space-3);
}

.footer {
  padding: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.connection-status {
  display: flex;
  align-items: center;
  font-size: var(--font-size-sm);
  gap: var(--space-2);
  white-space: nowrap;
  overflow: hidden;
}

.sidebar.collapsed .connection-status {
  justify-content: center;
}

@media (max-width: 768px) {
  .sidebar {
    width: 100% !important;
    height: auto;
    flex-direction: row;
    border-right: none;
    border-top: 1px solid var(--color-border);
    padding-bottom: env(safe-area-inset-bottom);
  }
  
  .brand, .footer {
    display: none;
  }
  
  .nav-menu {
    flex-direction: row;
    justify-content: space-around;
    padding: var(--space-2);
    overflow-x: auto;
  }
  
  .nav-item {
    flex-direction: column;
    padding: var(--space-2);
    border-radius: var(--radius-base);
    min-width: 64px;
    justify-content: center;
  }
  
  .nav-label {
    display: block !important;
    margin-left: 0;
    margin-top: var(--space-1);
    font-size: 0.75rem;
  }
  
  .nav-icon {
    font-size: 1.5rem;
  }
}
</style>
