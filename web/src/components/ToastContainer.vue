<template>
  <div class="toast-container">
    <transition-group name="toast-fade" tag="div" class="toast-list">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast--${toast.type}`">
        <span class="toast__message">{{ toast.message }}</span>
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { useToast } from '../composables/useToast'

const { toasts } = useToast()
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 3000;
  pointer-events: none;
}

.toast-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toast {
  min-width: 240px;
  max-width: 320px;
  padding: 12px 16px;
  border-radius: 10px;
  color: #fff;
  font-size: 14px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
  pointer-events: auto;
}

.toast--success {
  background: #16a34a;
}

.toast--error {
  background: #dc2626;
}

.toast--info {
  background: #2563eb;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
