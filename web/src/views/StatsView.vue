<script setup lang="ts">
import { onMounted, computed, ref, watch } from 'vue'
import ToolUsageChart from '../components/ToolUsageChart.vue'
import TavilyQuotaPanel from '../components/TavilyQuotaPanel.vue'
import TablePagination from '../components/TablePagination.vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'
import { Refresh } from '@element-plus/icons-vue'
const api=useApi(),toast=useToast(),loading=ref(false),overview=ref<any>(null),tools=ref<any>(null),keys=ref<any[]>([])
const provider=ref('all'),keyword=ref(''),page=ref(1),pageSize=ref(20)
const filtered=computed(()=>keys.value.filter(k=>(provider.value==='all'||k.provider===provider.value)&&`${k.id} ${k.display_name||''} ${k.key_preview}`.toLowerCase().includes(keyword.value.toLowerCase())))
const visible=computed(()=>filtered.value.slice((page.value-1)*pageSize.value,page.value*pageSize.value))
watch([provider,keyword,pageSize],()=>page.value=1)
watch(()=>filtered.value.length,()=>{page.value=Math.min(page.value,Math.max(1,Math.ceil(filtered.value.length/pageSize.value)))})
async function load(){loading.value=true;try{const [o,t,k]=await Promise.all([api.get<any>('/api/stats/overview'),api.get<any>('/api/stats/tools'),api.get<any>('/api/stats/keys')]);overview.value=o;tools.value=t.tools;keys.value=k.keys}catch(e){toast.error((e as Error).message)}finally{loading.value=false}}
const states:Record<string,string>={active:'可用',disabled:'已停用',quota_exceeded:'额度暂停',banned:'密钥失效'}
onMounted(load)
</script>
<template>
 <div class="list-view" v-loading="loading">
  <div class="overview-actions"><el-button :icon="Refresh" @click="load">刷新</el-button></div>
  <TavilyQuotaPanel :quota="overview?.quota"/>
  <div class="stats-charts">
   <section class="panel chart-panel"><ToolUsageChart :data="tools" :loading="loading"/></section>
   <section class="panel exa-billing-panel"><h3>Exa 当月费用 · USD</h3><dl><div><dt>网关记录</dt><dd>${{Number(overview?.exa_cost?.total_usd||0).toFixed(4)}}</dd></div><div><dt>上游返回</dt><dd>${{Number(overview?.exa_cost?.reported_usd||0).toFixed(4)}}</dd></div><div><dt>按官方价格估算</dt><dd>${{Number(overview?.exa_cost?.estimated_usd||0).toFixed(4)}}</dd></div><div><dt>费用待确认</dt><dd>{{overview?.exa_cost?.unsettled||0}} 项</dd></div></dl><p class="field-help">统计经本网关产生的费用；官方月用量可在密钥的「费用」中同步。</p></section>
  </div>
  <div class="list-toolbar"><el-select v-model="provider" style="width:145px"><el-option label="全部渠道" value="all"/><el-option label="Tavily" value="tavily"/><el-option label="Exa" value="exa"/></el-select><el-input v-model="keyword" clearable class="list-search" placeholder="搜索备注、尾号或 ID"/></div>
  <section class="panel list-panel">
   <el-table :data="visible" stripe row-key="id" empty-text="没有符合条件的数据">
    <el-table-column prop="id" label="ID" width="65"/><el-table-column prop="provider" label="渠道" width="90"/>
    <el-table-column label="密钥" min-width="200"><template #default="{row}"><code>{{row.key_preview}}</code><div class="text-muted">{{row.display_name}}</div></template></el-table-column>
    <el-table-column label="状态" width="110"><template #default="{row}">{{states[row.status]||row.status}}</template></el-table-column>
    <el-table-column prop="success" label="成功" width="100"/><el-table-column prop="failed" label="失败" width="100"/>
    <el-table-column label="当月用量 / 费用" min-width="230"><template #default="{row}"><template v-if="row.provider==='exa'">${{Number(row.billing?.total_usd||0).toFixed(4)}} <span class="text-muted">网关记录</span><div v-if="row.billing?.official" class="text-muted">官方用量 ${{row.billing.official.usedUsd.toFixed(4)}}</div></template><template v-else>{{row.quota?.used_count??0}} / {{row.quota?.quota_limit??'未知'}} credits<el-progress v-if="row.quota?.quota_limit" :percentage="Math.min(100,row.quota.used_count/row.quota.quota_limit*100)" :show-text="false" :stroke-width="5"/></template></template></el-table-column>
   </el-table>
   <TablePagination v-model:page="page" v-model:page-size="pageSize" :total="filtered.length"/>
  </section>
 </div>
</template>
