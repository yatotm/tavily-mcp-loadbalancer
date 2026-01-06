<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useToast } from '../composables/useToast'
import type { FormInstance, FormRules } from 'element-plus'

const settingsStore = useSettingsStore()
const loading = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const { success, error } = useToast()

// Local form state
const form = reactive({
  maxConcurrentRequests: 10,
  requestTimeoutMs: 60000,
  logRetentionDays: 7,
  logLevel: 'info',
  logFormat: 'json'
})

const rules = reactive<FormRules>({
  maxConcurrentRequests: [
    { required: true, message: '必填', trigger: 'blur' },
    { type: 'number', min: 1, message: '最小值为 1', trigger: 'blur' }
  ],
  requestTimeoutMs: [
    { required: true, message: '必填', trigger: 'blur' },
    { type: 'number', min: 100, message: '最小值为 100 毫秒', trigger: 'blur' }
  ],
  logRetentionDays: [
    { required: true, message: '必填', trigger: 'blur' },
    { type: 'number', min: 1, message: '最小值为 1 天', trigger: 'blur' }
  ]
})

const fetchSettings = async () => {
  loading.value = true
  try {
    const data = await settingsStore.fetchSettings()
    // Populate form
    if (data.config) {
      form.maxConcurrentRequests = data.config.maxConcurrentRequests
      form.requestTimeoutMs = data.config.requestTimeoutMs
      form.logRetentionDays = data.config.logRetentionDays
      form.logLevel = data.config.logLevel
      form.logFormat = data.config.logFormat
    }
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to load settings')
  } finally {
    loading.value = false
  }
}

const handleSave = async (formEl: FormInstance | undefined) => {
  if (!formEl) return
  await formEl.validate(async (valid) => {
    if (valid) {
      saving.value = true
      try {
        await settingsStore.saveSettings({ ...form })
        success('Settings saved successfully')
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to save settings')
      } finally {
        saving.value = false
      }
    }
  })
}

onMounted(() => {
  fetchSettings()
})
</script>

<template>
  <div class="settings-view">
    <div class="view-header">
      <h2 class="view-title">系统设置</h2>
    </div>

    <el-card
      shadow="never"
      class="settings-card"
      v-loading="loading"
      :body-style="{ padding: 'var(--space-4)' }"
    >
      <el-form 
        ref="formRef" 
        :model="form" 
        :rules="rules" 
        label-width="200px" 
        label-position="left"
        style="max-width: 800px"
      >
        <div class="form-section">
          <h3>服务配置</h3>
          <el-divider />
          
          <el-form-item label="最大并发请求" prop="maxConcurrentRequests">
            <el-input-number v-model="form.maxConcurrentRequests" :min="1" :max="1000" />
            <div class="help-text">同时处理的最大请求数</div>
          </el-form-item>

          <el-form-item label="请求超时 (毫秒)" prop="requestTimeoutMs">
            <el-input-number v-model="form.requestTimeoutMs" :min="100" :step="1000" />
            <div class="help-text">上游 Tavily API 请求超时时间</div>
          </el-form-item>
        </div>

        <div class="form-section">
          <h3>日志配置</h3>
          <el-divider />
          
          <el-form-item label="日志保留天数" prop="logRetentionDays">
            <el-input-number v-model="form.logRetentionDays" :min="1" :max="365" />
            <div class="help-text">数据库中保留请求日志的天数</div>
          </el-form-item>

          <el-form-item label="日志级别" prop="logLevel">
            <el-select v-model="form.logLevel">
              <el-option label="Error" value="error" />
              <el-option label="Warn" value="warn" />
              <el-option label="Info" value="info" />
              <el-option label="Debug" value="debug" />
            </el-select>
          </el-form-item>

          <el-form-item label="日志格式" prop="logFormat">
            <el-select v-model="form.logFormat">
              <el-option label="JSON" value="json" />
              <el-option label="Text" value="text" />
            </el-select>
          </el-form-item>
        </div>

        <div class="form-actions">
          <el-button type="primary" size="default" :loading="saving" @click="handleSave(formRef)">
            保存设置
          </el-button>
          <el-button size="default" @click="fetchSettings" :disabled="saving">重置</el-button>
        </div>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.settings-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.view-header {
  margin-bottom: var(--space-2);
}

.view-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.settings-card {
  border-radius: var(--radius-lg);
}

.form-section {
  margin-bottom: var(--space-6);
}

.form-section h3 {
  margin-bottom: var(--space-2);
  color: var(--color-text-primary);
  font-size: 1.1rem;
}

.help-text {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-top: 4px;
}

.form-actions {
  margin-top: var(--space-6);
  display: flex;
  gap: var(--space-4);
}
</style>
