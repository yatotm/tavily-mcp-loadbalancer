<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'

const props = defineProps<{
  modelValue: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'submit', payload: { keys: string[] }): void
}>()

const formRef = ref<FormInstance>()
const form = reactive({
  keys_input: ''
})

const rules = reactive<FormRules>({
  keys_input: [
    { required: true, message: '请输入至少一个 API Key', trigger: 'blur' }
  ]
})

// Parse keys from input (comma or newline separated)
const parsedKeys = computed(() => {
  return form.keys_input
    .split(/[,\n]/)
    .map(k => k.trim())
    .filter(k => k.length > 0)
})

const keyCount = computed(() => parsedKeys.value.length)

const handleClose = () => {
  emit('update:modelValue', false)
  form.keys_input = ''
  formRef.value?.resetFields()
}

const handleSubmit = async (formEl: FormInstance | undefined) => {
  if (!formEl) return
  await formEl.validate((valid) => {
    if (valid && parsedKeys.value.length > 0) {
      emit('submit', { keys: parsedKeys.value })
    }
  })
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    title="新增 API Key"
    width="500px"
    @closed="handleClose"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      label-position="top"
    >
      <el-form-item label="API Key" prop="keys_input">
        <el-input
          v-model="form.keys_input"
          type="textarea"
          :rows="4"
          placeholder="输入 Tavily API Key，支持批量导入&#10;多个 Key 用英文逗号或换行分隔&#10;例如: tvly-xxx, tvly-yyy"
        />
      </el-form-item>

      <div class="key-count" v-if="keyCount > 0">
        已识别 <strong>{{ keyCount }}</strong> 个 Key
      </div>
    </el-form>

    <template #footer>
      <span class="dialog-footer">
        <el-button size="default" @click="handleClose">取消</el-button>
        <el-button
          size="default"
          type="primary"
          :loading="loading"
          :disabled="keyCount === 0"
          @click="handleSubmit(formRef)"
        >
          添加{{ keyCount > 1 ? ` (${keyCount})` : '' }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<style scoped>
.key-count {
  font-size: 0.9em;
  color: var(--color-text-secondary);
  margin-top: -8px;
}

.key-count strong {
  color: var(--color-primary);
}
</style>
