<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'
const props=defineProps<{ keyId: number | null }>()
const emit=defineEmits<{(e:'close'):void;(e:'saved'):void}>()
const api=useApi(),toast=useToast(),loading=ref(false),syncing=ref(false),saving=ref(false),synced=ref(''),syncError=ref('')
const form=reactive({ resetMode:'auto',resetDay:1,publicId:'',serviceKey:'',serviceKeyConfigured:false })
async function load(){if(!props.keyId)return;loading.value=true;try{const data=await api.get<any>(`/api/keys/${props.keyId}/billing`);Object.assign(form,data.config,{serviceKey:''});synced.value=data.config.syncedAt||'';syncError.value=data.config.syncError||''}catch(e){toast.error((e as Error).message)}finally{loading.value=false}}
async function save(close=true){saving.value=true;try{await api.put(`/api/keys/${props.keyId}/billing`,{resetMode:form.resetMode,resetDay:form.resetDay,publicId:form.publicId,serviceKey:form.serviceKey});toast.success('费用设置已保存');emit('saved');if(close)emit('close');return true}catch(e){toast.error((e as Error).message);return false}finally{saving.value=false}}
async function sync(){if(!await save(false))return;syncing.value=true;try{await api.post(`/api/keys/${props.keyId}/billing/sync`);toast.success('官方用量已同步');emit('saved')}catch(e){toast.error((e as Error).message)}finally{syncing.value=false;await load()}}
watch(()=>props.keyId,load,{immediate:true})
</script>
<template>
  <el-dialog :model-value="keyId!==null" title="Exa 费用与额度" width="520px" @close="emit('close')">
    <div v-loading="loading" class="billing-form">
      <label class="field"><span>额度耗尽后的恢复规则</span><el-select v-model="form.resetMode"><el-option label="按官方规则" value="auto"/><el-option label="每月指定日期" value="monthly"/><el-option label="手动恢复" value="manual"/></el-select></label>
      <label v-if="form.resetMode==='monthly'" class="field"><span>每月恢复日（UTC）</span><el-input-number v-model="form.resetDay" :min="1" :max="28"/></label>
      <p class="field-help">自动模式适用于每月领取免费额度的首个团队，无余额时在月初恢复轮询。其他账户可选手动恢复；预算超限需确认账期。失效密钥不会自动启用。</p>
      <details open><summary>官方用量接口（可选）</summary><div class="billing-form">
        <label class="field"><span>publicId</span><el-input v-model="form.publicId" placeholder="key_…（控制台中的公开 ID）"/></label>
        <label class="field"><span>Service Key <em v-if="form.serviceKeyConfigured">已保存</em></span><el-input v-model="form.serviceKey" type="password" show-password :placeholder="form.serviceKeyConfigured?'留空保留当前密钥':'需要同团队的 Service Key'" autocomplete="new-password"/></label>
        <p class="field-help">需要开通 Exa Team Management。未配置时按官方价格记录网关费用，不推测账户余额。</p>
        <p v-if="synced" class="field-help">上次同步：{{ new Date(synced).toLocaleString() }}</p><p v-if="syncError" class="error-text">{{ syncError }}</p>
        <el-button :loading="syncing" :disabled="!form.publicId || (!form.serviceKey && !form.serviceKeyConfigured)" @click="sync">保存并同步用量</el-button>
      </div></details>
    </div>
    <template #footer><el-button @click="emit('close')">取消</el-button><el-button type="primary" :loading="saving" @click="save()">保存</el-button></template>
  </el-dialog>
</template>
<style scoped>.billing-form{display:grid;gap:18px}.billing-form details{border-top:1px solid var(--color-border);padding-top:18px}.billing-form summary{margin-bottom:18px}</style>
