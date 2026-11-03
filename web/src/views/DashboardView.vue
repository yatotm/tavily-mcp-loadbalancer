<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'
import { useStatsStore } from '../stores/stats'
import TimelineChart from '../components/TimelineChart.vue'
import TavilyQuotaPanel from '../components/TavilyQuotaPanel.vue'
import { CopyDocument, TopRight, Refresh } from '@element-plus/icons-vue'
const api = useApi(), toast = useToast(), stats = useStatsStore()
const loading = ref(true), providers = ref<any[]>([]), timeline = ref({}), review = ref<any>({}), exaBilling = ref<any>({})
const selectedProvider = ref<any>(null), showTools = ref(false), lastUpdated = ref('')
const overview = computed(() => stats.overview)
const uptime = computed(() => { const s = overview.value?.system.uptime || 0; return s > 86400 ? `${Math.floor(s/86400)} 天` : `${Math.floor(s/3600)} 小时 ${Math.floor(s%3600/60)} 分钟` })
async function load() {
  loading.value = true
  try {
    const [o, p, t] = await Promise.all([api.get<any>('/api/stats/overview'), api.get<any>('/api/providers'), api.get<any>('/api/stats/timeline')])
    stats.updateFromApi({ overview: o }); providers.value = p.providers; exaBilling.value = p.exaBilling || {}; review.value = p.review; timeline.value = t.timeline
    lastUpdated.value = new Date().toLocaleTimeString()
  } catch(e) { toast.error((e as Error).message) } finally { loading.value = false }
}
const endpoint = (path: string) => `${window.location.origin}${path}`
async function copy(path: string) {
  const text = endpoint(path)
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text)
    else { const input = document.createElement('textarea'); input.value = text; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select(); const ok = document.execCommand('copy'); input.remove(); if (!ok) throw new Error() }
    toast.success('接入地址已复制')
  } catch { toast.error('复制失败，请手动选择地址复制') }
}
onMounted(load)
</script>
<template>
  <div class="dashboard-view" v-loading="loading">
    <div class="overview-actions"><el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button></div>
    <TavilyQuotaPanel :quota="overview?.quota"/>
    <div class="metric-grid">
      <div class="metric"><span>工具请求</span><strong>{{ overview?.requests.total.toLocaleString() ?? '—' }}</strong><small>保留期内 · 不含配额同步与审查</small></div>
      <div class="metric"><span>上游成功率</span><strong>{{ overview ? `${overview.requests.success_rate.toFixed(1)}%` : '—' }}</strong><small>{{ overview?.requests.failed ?? '—' }} 次失败尝试</small></div>
      <div class="metric"><span>最近响应耗时</span><strong>{{ overview ? (overview.requests.avg_response_time_ms / 1000).toFixed(2) : '—' }}<i>秒</i></strong><small>最近 50 次上游调用平均值</small></div>
      <div class="metric"><span>可用密钥</span><strong>{{ overview?.keys.active ?? '—' }}<i>/ {{ overview?.keys.total ?? '—' }}</i></strong></div>
    </div>
    <div class="section-line"><h3>搜索渠道</h3></div>
    <div class="provider-grid">
      <section class="panel provider-card" v-for="p in providers" :key="p.id">
        <div class="provider-top"><div class="provider-mark" :class="p.id">{{ p.name[0] }}</div><div><h3>{{ p.name }}</h3></div><el-tag :type="p.keys.some((k:any) => k.status === 'active') ? 'success' : 'info'" effect="plain">{{ p.keys.some((k:any) => k.status === 'active') ? '已就绪' : '待配置密钥' }}</el-tag></div>
        <div class="provider-facts"><span><strong>{{ p.keys.filter((k:any) => k.status === 'active').length }}</strong> 可用 Key</span><button @click="selectedProvider = p; showTools = true">查看 {{ p.tools.length }} 个工具 <el-icon><TopRight /></el-icon></button><span class="review-indicator" :class="{ enabled: p.reviewEnabled }">{{ p.reviewEnabled ? '审查已开启' : '审查未开启' }}</span></div>
        <div class="endpoint-row" v-for="kind in ['mcp','sse']" :key="kind"><span>{{ kind === 'mcp' ? 'HTTP' : 'SSE' }}</span><code>{{ endpoint(p.endpoints[kind]) }}</code><button :aria-label="`复制 ${p.name} ${kind} 地址`" @click="copy(p.endpoints[kind])"><el-icon><CopyDocument /></el-icon></button></div>
        <p v-if="p.id === 'tavily'" class="provider-note">原有 /sse、/message、/mcp 地址继续可用。</p><div v-else class="exa-cost-summary"><span>本月网关费用 <strong>${{Number(exaBilling.total_usd||0).toFixed(4)}}</strong></span><small>上游返回 ${{Number(exaBilling.reported_usd||0).toFixed(4)}} · 估算 ${{Number(exaBilling.estimated_usd||0).toFixed(4)}}<template v-if="exaBilling.unsettled"> · {{exaBilling.unsettled}} 项待确认</template></small></div>
      </section>
    </div>
    <div class="overview-bottom">
      <section class="panel chart-panel"><TimelineChart :data="timeline" :loading="loading" /></section>
      <section class="panel review-panel"><h3>结果审查</h3><div class="review-number">{{ review.removed?.toLocaleString() ?? 0 }}<span>条内容已筛除</span></div><dl><div><dt>审查请求</dt><dd>{{ review.total ?? 0 }}</dd></div><div><dt>审查失败</dt><dd>{{ review.failed ?? 0 }}</dd></div><div><dt>平均审查耗时</dt><dd>{{ review.avg_ms ?? 0 }} ms</dd></div></dl><a href="#settings">配置决策模型 <el-icon><TopRight /></el-icon></a></section>
    </div>
    <div class="system-strip"><span>已运行 {{ uptime }}</span><span>{{ overview?.system.sse_connections ?? 0 }} 个 SSE 连接</span><span>概览更新于 {{ lastUpdated || '—' }}</span></div>
    <el-dialog v-model="showTools" :title="`${selectedProvider?.name || ''} 工具目录`" width="760px"><div v-for="tool in selectedProvider?.tools" :key="tool.name" class="tool-item"><code>{{ tool.name }}</code><p>{{ tool.description }}</p><details><summary>参数定义</summary><pre>{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre></details></div></el-dialog>
  </div>
</template>
