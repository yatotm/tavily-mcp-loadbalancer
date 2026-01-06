<script setup lang="ts">
// MainLayout serves as the structural shell
</script>

<template>
  <div class="layout-container">
    <div class="layout-sidebar">
      <slot name="sidebar"></slot>
    </div>
    
    <div class="layout-main">
      <div class="layout-header">
        <slot name="header"></slot>
      </div>
      
      <main class="layout-content">
        <slot></slot>
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background-color: var(--color-background);
}

.layout-sidebar {
  height: 100%;
  flex-shrink: 0;
  z-index: 20;
}

.layout-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0; /* Prevent flex overflow */
  height: 100%;
}

.layout-header {
  flex-shrink: 0;
  z-index: 10;
}

.layout-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
  position: relative;
}

/* Scrollbar styling for content */
.layout-content::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.layout-content::-webkit-scrollbar-track {
  background: transparent;
}

.layout-content::-webkit-scrollbar-thumb {
  background-color: #cbd5e1;
  border-radius: 4px;
}

.layout-content::-webkit-scrollbar-thumb:hover {
  background-color: #94a3b8;
}

@media (max-width: 768px) {
  .layout-container {
    flex-direction: column;
  }

  .layout-sidebar {
    height: auto;
    width: 100%;
    order: 2; /* Move to bottom */
    flex-shrink: 0;
  }

  .layout-main {
    height: auto;
    flex: 1;
    overflow-y: hidden; /* MainLayout handles scroll in content */
    display: flex;
    flex-direction: column;
    order: 1;
  }

  .layout-content {
    padding: var(--space-4);
    overflow-y: auto;
  }
}
</style>
