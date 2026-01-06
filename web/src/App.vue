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

const handleLoggedIn = () => {
  showLoginModal.value = false;
  // Refresh data after login
  window.location.reload();
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

const handleSync = async () => {
  if (syncing.value) return;
  syncing.value = true;
  try {
    await api.post('/api/settings/sync');
    toast.success('配额同步完成');
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '同步失败');
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

onMounted(() => {
  checkAuthRequired();
  checkResponsive();
  window.addEventListener('resize', checkResponsive);
});

onUnmounted(() => {
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
    <template v-else>
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
            @toggle-sidebar="handleToggleSidebar"
            @sync="handleSync"
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
