<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import MainLayout from './layouts/MainLayout.vue';
import SideNav from './components/SideNav.vue';
import HeaderBar from './components/HeaderBar.vue';
import DashboardView from './views/DashboardView.vue';
import KeysView from './views/KeysView.vue';
import StatsView from './views/StatsView.vue';
import LogsView from './views/LogsView.vue';
import SettingsView from './views/SettingsView.vue';
import ToastContainer from './components/ToastContainer.vue';
import LoginModal from './components/LoginModal.vue';
import { useAuthStore } from './stores/auth';
import { useApi } from './composables/useApi';
import { useToast } from './composables/useToast';
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
const connectionStatus = ref<'connected' | 'disconnected' | 'connecting'>('connected');
const showLoginModal = ref(false);
const initialLoading = ref(true);

// Check if auth is required on startup
const checkAuthRequired = async () => {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.authRequired) {
      authStore.setAuthRequired(true);
      if (!authStore.token) {
        showLoginModal.value = true;
      }
    }
  } catch {
    // Health check failed, proceed without auth requirement
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

const contentKey = ref(0);

const handleLoggedIn = () => {
  // 关闭登录框后刷新同步状态，并用 contentKey 强制 remount 主视图以重新拉数
  // 不要 window.location.reload()，否则会整页刷新形成登录死循环
  showLoginModal.value = false;
  contentKey.value += 1;
  fetchSyncStatus();
};

// View Titles
const viewTitles: Record<string, string> = {
  dashboard: '仪表盘',
  keys: 'API Key 管理',
  stats: '使用统计',
  logs: '请求日志',
  settings: '系统设置'
};

const currentTitle = computed(() => viewTitles[currentView.value] || 'Tavily Load Balancer');

// Actions
const handleToggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
};

const syncing = ref(false);
const syncStatus = ref<UsageSyncQueueStatus | null>(null);
let syncStatusTimer: ReturnType<typeof setInterval> | null = null;

const fetchSyncStatus = async () => {
  // 未登录时不要打受保护接口，否则会刷 401 / Unauthorized
  if (authStore.requiresAuth && !authStore.token) return;
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
  } else if (width >= 1024) {
    isSidebarCollapsed.value = false;
  }
};

onMounted(async () => {
  checkResponsive();
  // 先确认是否需要登录，再决定是否轮询受保护接口
  await checkAuthRequired();
  fetchSyncStatus();
  syncStatusTimer = setInterval(fetchSyncStatus, 10000);
  window.addEventListener('resize', checkResponsive);
});

// 登录成功写入 token 后立刻拉一次同步状态
watch(
  () => authStore.token,
  (token) => {
    if (token || !authStore.requiresAuth) {
      fetchSyncStatus();
    }
  }
);

onUnmounted(() => {
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

    <!-- Main app：未登录且需要鉴权时不挂载会打受保护 API 的主视图 -->
    <template v-else>
      <MainLayout v-if="!authStore.authRequired" :key="contentKey">
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
          />
        </template>

        <div class="view-content" :key="contentKey">
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
