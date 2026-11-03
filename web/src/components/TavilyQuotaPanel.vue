<script setup lang="ts">
import { computed } from 'vue'
import type { QuotaStats } from '../stores/stats'
const props=defineProps<{quota?:QuotaStats|null}>()
const format=(n?:number|null)=>n==null?'—':n.toLocaleString()
const limit=computed(()=>props.quota?.known_limit ?? props.quota?.limit)
const remaining=computed(()=>props.quota?.known_remaining ?? props.quota?.remaining)
const progress=computed(()=>limit.value ? Math.min(100,100*(limit.value-(remaining.value||0))/limit.value) : 0)
</script>
<template>
 <section class="panel quota-panel">
  <div class="quota-heading"><h3>Tavily 当月额度</h3><span>{{quota?.period}} · credits</span></div>
  <div class="quota-metrics">
   <div><span>已用量</span><strong>{{format(quota?.used)}}</strong></div>
   <div><span>{{quota?.unknown_keys?'已知总额度':'总额度'}}</span><strong>{{format(limit)}}</strong></div>
   <div><span>{{quota?.unknown_keys?'已知剩余额度':'剩余额度'}}</span><strong>{{format(remaining)}}</strong></div>
   <div><span>可用额度</span><strong class="available-quota">{{format(quota?.available)}}</strong></div>
  </div>
  <el-progress :percentage="progress" :show-text="false" :stroke-width="7"/>
  <p class="quota-note">可用额度仅统计启用中的密钥。<span v-if="quota?.unknown_keys">{{quota.unknown_keys}} 个密钥额度未知，未计入总额度和剩余额度。</span></p>
 </section>
</template>
