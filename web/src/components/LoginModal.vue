<template>
  <el-dialog
    v-model="visible"
    title="管理员登录"
    width="360px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    align-center
  >
    <el-form @submit.prevent="handleLogin">
      <el-form-item label="密码" :error="error">
        <el-input
          v-model="password"
          type="password"
          show-password
          placeholder="请输入管理员密码"
          @keyup.enter="handleLogin"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleCancel" :disabled="loading">取消</el-button>
      <el-button type="primary" :disabled="!password.trim() || loading" :loading="loading" @click="handleLogin">
        登录
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '../stores/auth'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'logged-in'): void
}>()

const authStore = useAuthStore()
const password = ref('')
const error = ref('')

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const resetState = () => {
  password.value = ''
  error.value = ''
}

watch(
  () => props.modelValue,
  (next) => {
    if (!next) resetState()
  }
)

const loading = ref(false)

const handleLogin = async () => {
  if (!password.value.trim()) {
    error.value = '请输入密码'
    return
  }

  loading.value = true
  error.value = ''

  try {
    // Test the password by making an authenticated request
    const res = await fetch('/api/keys', {
      headers: { 'X-Admin-Token': password.value.trim() }
    })

    if (res.status === 401) {
      error.value = '密码错误'
      return
    }

    if (!res.ok) {
      error.value = '认证失败'
      return
    }

    // Password is correct, save it
    authStore.login(password.value)
    emit('logged-in')
    visible.value = false
    resetState()
  } catch {
    error.value = '连接错误'
  } finally {
    loading.value = false
  }
}

const handleCancel = () => {
  visible.value = false
  resetState()
}
</script>
