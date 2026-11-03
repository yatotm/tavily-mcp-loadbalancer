<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, defineAsyncComponent } from 'vue';
import MainLayout from './layouts/MainLayout.vue';
import SideNav from './components/SideNav.vue';
import HeaderBar from './components/HeaderBar.vue';
const DashboardView = defineAsyncComponent(() => import('./views/DashboardView.vue'));
const KeysView = defineAsyncComponent(() => import('./views/KeysView.vue'));
const StatsView = defineAsyncComponent(() => import('./views/StatsView.vue'));
const LogsView = defineAsyncComponent(() => import('./views/LogsView.vue'));
const SettingsView = defineAsyncComponent(() => import('./views/SettingsView.vue'));
import ToastContainer from './components/ToastContainer.vue';
import LoginModal from './components/LoginModal.vue';
import { useAuthStore } from './stores/auth';
import { useApi } from './composables/useApi';
import { useToast } from './composables/useToast';
import { useWebSocket } from './composables/useWebSocket';
import { ElMessageBox } from 'element-plus';
import type { UsageSyncEnqueueResult, UsageSyncQueueStatus } from './stores/keys';

const authStore = useAuthStore();
const api = useApi();
const toast = useToast();

// Valid views
const validViews = ['dashboard', 'keys', 'stats', 'logs', 'settings'];

// Get initial view from URL hash
const getViewFromHash = (): string => {
  const hash = window.location.hash.slice(1); // Remove '#'
  return validViews.includes(hash) ? hash : 'dashboard';
};

// State
const currentView = ref(getViewFromHash());

// Sync view with URL hash
watch(currentView, (newView) => {
  window.location.hash = newView;
});

// Listen to hash changes (browser back/forward)
const handleHashChange = () => {
  const view = getViewFromHash();
  if (view !== currentView.value) {
    currentView.value = view;
  }
};

onMounted(() => {
  window.addEventListener('hashchange', handleHashChange);
});

onUnmounted(() => {
  window.removeEventListener('hashchange', handleHashChange);
});
const isSidebarCollapsed = ref(false);
const websocket = useWebSocket();
const connectionStatus = computed(() => websocket.isConnected.value ? 'connected' as const : 'disconnected' as const);
const startupError = ref('');
const showLoginModal = ref(false);
const initialLoading = ref(true);

// Check if auth is required on startup
const checkAuthRequired = async () => {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error('健康检查失败');
    const data = await res.json();
    if (data.authRequired) {
      authStore.setAuthRequired(true);
      if (!authStore.token) {
        showLoginModal.value = true;
      }
    }
    if (!authStore.authRequired) { websocket.connect(); fetchSyncStatus(); }
  } catch {
    startupError.value = '无法连接网关，请检查服务后重试。';
  } finally {
    initialLoading.value = false;
  }
};

// Watch for auth requirement changes (e.g., 401 response)
watch(() => authStore.authRequired, (required) => {
  if (required) {
    showLoginModal.value = true;
  }
});

const handleLoggedIn = () => {
  showLoginModal.value = false;
  // Refresh data after login
  window.location.reload();
};

// View Titles
const viewTitles: Record<string, string> = {
  dashboard: '运行总览',
  keys: '密钥池',
  stats: '使用统计',
  logs: '请求日志',
  settings: '系统设置'
};

const currentTitle = computed(() => viewTitles[currentView.value] || 'Search Gateway');

// Actions
const handleToggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
};

const syncing = ref(false);
const syncStatus = ref<UsageSyncQueueStatus | null>(null);
let syncStatusTimer: ReturnType<typeof setInterval> | null = null;

const fetchSyncStatus = async () => {
  if (authStore.authRequired || initialLoading.value || startupError.value) return;
  try {
    syncStatus.value = await api.get<UsageSyncQueueStatus>('/api/settings/sync/status');
  } catch {
    // Keep the header usable if the status request temporarily fails.
  }
};

const handleSync = async (mode: 'stale' | 'all') => {
  if (syncing.value) return;
  if (mode === 'all') {
    try {
      await ElMessageBox.confirm(
        '全部 Key 将进入低频后台队列。Key 较多时可能需要约一小时，是否继续？',
        '同步全部配额',
        { confirmButtonText: '加入队列', cancelButtonText: '取消', type: 'warning' }
      );
    } catch {
      return;
    }
  }
  syncing.value = true;
  try {
    const result = await api.post<UsageSyncEnqueueResult>('/api/settings/sync', { mode });
    const parts = [`已加入 ${result.enqueued} 个 Key`];
    if (result.deduplicated > 0) parts.push(`自动去重 ${result.deduplicated} 个`);
    if (result.promoted > 0) parts.push(`提升优先级 ${result.promoted} 个`);
    if (result.enqueued > 0) toast.success(parts.join('，'));
    else toast.info(parts.join('，'));
    syncStatus.value = result.queue;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '加入同步队列失败');
  } finally {
    syncing.value = false;
  }
};

// Responsive handling for sidebar (auto-collapse on tablet)
const checkResponsive = () => {
  const width = window.innerWidth;
  if (width > 768 && width < 1024) {
    isSidebarCollapsed.value = true;
  } else {
    isSidebarCollapsed.value = false;
  }
};

onMounted(() => {
  checkAuthRequired();
  checkResponsive();
  syncStatusTimer = setInterval(fetchSyncStatus, 10000);
  window.addEventListener('resize', checkResponsive);
});

onUnmounted(() => {
  websocket.disconnect();
  if (syncStatusTimer) clearInterval(syncStatusTimer);
  window.removeEventListener('resize', checkResponsive);
});
</script>

<template>
  <div class="app-shell">
    <!-- Loading state -->
    <div v-if="initialLoading" class="loading-container">
      <el-icon class="loading-icon"><i class="el-icon-loading" /></el-icon>
    </div>

    <!-- Main app -->
    <div v-else-if="startupError" class="startup-error"><h2>暂时无法连接</h2><p>{{ startupError }}</p><el-button @click="startupError = ''; checkAuthRequired()">重试</el-button></div>
    <template v-else-if="!authStore.authRequired">
      <MainLayout>
        <template #sidebar>
          <SideNav
            v-model:currentView="currentView"
            :collapsed="isSidebarCollapsed"
            :connection-status="connectionStatus"
          />
        </template>

        <template #header>
          <HeaderBar
            :title="currentTitle"
            :collapsed="isSidebarCollapsed"
            :syncing="syncing"
            :sync-status="syncStatus"
            @toggle-sidebar="handleToggleSidebar"
            @sync-stale="handleSync('stale')"
            @sync-all="handleSync('all')"
            @logout="authStore.logout(); websocket.disconnect(); showLoginModal = true"
            :can-logout="!!authStore.token"
          />
        </template>

        <div class="view-content">
          <DashboardView v-if="currentView === 'dashboard'" />
          <KeysView v-else-if="currentView === 'keys'" />
          <StatsView v-else-if="currentView === 'stats'" />
          <LogsView v-else-if="currentView === 'logs'" />
          <SettingsView v-else-if="currentView === 'settings'" />
        </div>
      </MainLayout>
    </template>

    <!-- Login Modal -->
    <LoginModal
      v-model="showLoginModal"
      @logged-in="handleLoggedIn"
    />

    <ToastContainer />
  </div>
</template>

<style scoped>
.app-shell {
  height: 100%;
}

.view-content {
  height: 100%;
}

.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: var(--color-background);
}

.loading-icon {
  font-size: 32px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
