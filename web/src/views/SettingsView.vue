<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'
const api = useApi(), toast = useToast()
const loading = ref(true), saving = ref(false), testing = ref(false), loaded = ref(false)
const snapshot = ref(''), testMessage = ref('')
const form = reactive({ maxConcurrentRequests: 4, requestTimeoutMs: 30000, logRetentionDays: 30, logLevel: 'info', logFormat: 'json', logResponseBodies: false,
  decision: { enabled: false, channels: { tavily: false, exa: false }, baseUrl: '', apiKey: '', apiKeyConfigured: false, model: 'decision-model-preview', timeoutMs: 10000, totalTimeoutMs: 45000, batchSize: 8, concurrency: 2, maxCalls: 64, maxBatchChars: 24000, threshold: 0.5 } })
const dirty = computed(() => loaded.value && JSON.stringify(form) !== snapshot.value)
async function load() {
  loading.value = true
  try {
    const { config } = await api.get<any>('/api/settings')
    for (const key of ['maxConcurrentRequests', 'requestTimeoutMs', 'logRetentionDays', 'logLevel', 'logFormat', 'logResponseBodies'] as const) (form as any)[key] = config[key]
    Object.assign(form.decision, config.decision, { apiKey: '' })
    snapshot.value = JSON.stringify(form); loaded.value = true
  } catch (e) { toast.error((e as Error).message) }
  finally { loading.value = false }
}
async function save() {
  saving.value = true
  try {
    await api.put('/api/settings', form)
    toast.success('设置已保存并生效'); await load()
  } catch (e) { toast.error((e as Error).message) }
  finally { saving.value = false }
}
async function test() {
  testing.value = true; testMessage.value = ''
  try {
    const data = await api.post<any>('/api/settings/decision/test', form.decision)
    testMessage.value = `连接成功 · ${data.model} · 普通文本风险概率 ${(data.probability * 100).toFixed(1)}%`
    toast.success('决策模型连接正常')
  } catch (e) { testMessage.value = (e as Error).message; toast.error(testMessage.value) }
  finally { testing.value = false }
}
onMounted(load)
</script>
<template>
  <div class="settings-view" v-loading="loading">

    <el-alert v-if="!loading && !loaded" title="无法加载设置，请重试" type="error" :closable="false"><el-button @click="load">重新加载</el-button></el-alert>
    <form v-if="loaded" @submit.prevent="save" class="settings-stack">
      <section class="panel">
        <div class="panel-heading"><div><h3>决策模型审查</h3></div><el-switch v-model="form.decision.enabled" aria-label="启用决策模型审查" active-text="启用" /></div>
        <div class="settings-body">
          <div class="channel-switches">
            <label class="channel-switch"><div class="provider-mark tavily">T</div><span><strong>Tavily</strong><small>搜索、提取、爬取与研究结果</small></span><el-switch v-model="form.decision.channels.tavily" aria-label="审查 Tavily 渠道" /></label>
            <label class="channel-switch"><div class="provider-mark exa">E</div><span><strong>Exa</strong><small>搜索、网页与 Agent 输出</small></span><el-switch v-model="form.decision.channels.exa" aria-label="审查 Exa 渠道" /></label>
          </div>
          <p class="field-help">总开关与渠道开关同时开启时生效。内容拒绝会拆分定位并剔除；服务故障、超时或审查额度耗尽时，暂不下发未审查内容。</p>
          <div class="form-grid">
            <label class="field full"><span>Base URL</span><el-input v-model="form.decision.baseUrl" placeholder="https://你的业务空间.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" autocomplete="off" /><small>支持填入 compatible-mode、v1 或完整 systemone 地址。</small></label>
            <label class="field"><span>API Key <em v-if="form.decision.apiKeyConfigured">已加密保存</em></span><el-input v-model="form.decision.apiKey" type="password" show-password :placeholder="form.decision.apiKeyConfigured ? '留空保留当前密钥' : '输入决策模型密钥'" autocomplete="new-password" /></label>
            <label class="field"><span>模型 ID</span><el-input v-model="form.decision.model" placeholder="decision-model-preview" /></label>
          </div>
          <div class="inline-actions"><el-button :loading="testing" :disabled="!form.decision.baseUrl || (!form.decision.apiKey && !form.decision.apiKeyConfigured)" @click="test">测试连接</el-button><small>使用当前填写的配置，仅发送一条普通文本。</small></div>
          <p v-if="testMessage" class="test-result" role="status">{{ testMessage }}</p>
          <details class="advanced"><summary>审查速度与预算</summary><div class="form-grid compact-grid">
            <label class="field"><span>每批条目数</span><el-input-number v-model="form.decision.batchSize" :min="1" :max="16" /></label>
            <label class="field"><span>同时审查批次</span><el-input-number v-model="form.decision.concurrency" :min="1" :max="4" /></label>
            <label class="field"><span>单次超时 / 毫秒</span><el-input-number v-model="form.decision.timeoutMs" :min="1000" :max="60000" :step="1000" /></label>
            <label class="field"><span>审查总时限 / 毫秒</span><el-input-number v-model="form.decision.totalTimeoutMs" :min="1000" :max="180000" :step="1000" /></label>
            <label class="field"><span>每次结果最多审查调用</span><el-input-number v-model="form.decision.maxCalls" :min="1" :max="256" /></label>
            <label class="field"><span>剔除阈值 P(有风险)</span><el-input-number v-model="form.decision.threshold" :min="0.01" :max="0.99" :step="0.01" :precision="2" /></label>
          </div><p class="field-help">长文本会完整分片检查。阈值越低，筛除越严格；模型判断仍可能有误判或漏判。</p></details>
        </div>
      </section>
      <section class="panel"><div class="panel-heading"><div><h3>请求与轮询</h3></div></div><div class="settings-body form-grid">
        <label class="field"><span>最大并发请求</span><el-input-number v-model="form.maxConcurrentRequests" :min="1" :max="100" /><small>超出并发后进入有界等待队列。</small></label>
        <label class="field"><span>请求时限 / 毫秒</span><el-input-number v-model="form.requestTimeoutMs" :min="1000" :max="300000" :step="1000" /><small>含排队和重试；研究任务至少预留 180 秒。</small></label>
      </div></section>
      <section class="panel"><div class="panel-heading"><div><h3>日志与存储</h3></div></div><div class="settings-body">
        <div class="form-grid compact-grid">
          <label class="field"><span>保留天数</span><el-input-number v-model="form.logRetentionDays" :min="1" :max="365" /></label>
          <label class="field"><span>日志级别</span><el-select v-model="form.logLevel"><el-option v-for="v in ['error','warn','info','debug']" :key="v" :label="v" :value="v" /></el-select></label>
          <label class="field"><span>日志格式</span><el-select v-model="form.logFormat"><el-option label="JSON" value="json" /><el-option label="Text" value="text" /></el-select></label>
        </div>
        <div class="setting-row"><div><strong>保存响应正文</strong><p>默认关闭。开启后保存脱敏且限长的上游原始响应，可能包含尚未审查的内容。</p></div><el-switch v-model="form.logResponseBodies" aria-label="保存响应正文" /></div>
      </div></section>
      <div class="save-bar"><span>{{ dirty ? '更改尚未保存' : '所有设置均已保存' }}</span><div><el-button :disabled="saving || !dirty" @click="load">撤销更改</el-button><el-button native-type="submit" type="primary" :loading="saving" :disabled="!dirty">保存设置</el-button></div></div>
    </form>
  </div>
</template>
