<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useKeysStore, type KeyRecord } from '../stores/keys'
import KeyTable from '../components/KeyTable.vue'
import AddKeyDialog from '../components/AddKeyDialog.vue'
import TablePagination from '../components/TablePagination.vue'
import ExaBillingDialog from '../components/ExaBillingDialog.vue'
import { useToast } from '../composables/useToast'
import { ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
const store=useKeysStore(), toast=useToast()
const loading=ref(false), adding=ref(false), busy=ref(false), showAdd=ref(false), billingKey=ref<number|null>(null)
const provider=ref<'tavily'|'exa'>('tavily'), keyword=ref(''), status=ref('all'), page=ref(1), pageSize=ref(20)
const selected=ref<KeyRecord[]>([]), table=ref<InstanceType<typeof KeyTable>>()
const ids=computed(()=>selected.value.map(k=>k.id))
const tests=ref<Record<number,{status:string;message:string}>>({})
let checkingTests=false, testTimer:ReturnType<typeof setInterval>|undefined, mounted=true
function finishTest(id:number,status:'success'|'error',message:string){
 tests.value[id]={status,message}
 if(status==='success')toast.success(`密钥 #${id}：${message}`);else toast.error(`密钥 #${id}：${message}`)
}
async function testKey(id:number){
 if(['running','queued'].includes(tests.value[id]?.status))return
 tests.value[id]={status:'running',message:'正在测试当前密钥'}
 try{
  const result=await store.testKey(id)
  if(!mounted)return
  if(result.status==='queued'){
   tests.value[id]={status:'queued',message:'已加入配额校验队列，遵守上游限流'}
   toast.info(`密钥 #${id} 已加入测试队列`)
  }else{
   const cost=result.costUsd==null?'':`，费用 $${result.costUsd.toFixed(4)}${result.costSource==='estimated'?'（估算）':''}`
   finishTest(id,result.status,(result.message||'测试完成')+cost)
  }
  await load(true)
 }catch(e){if(mounted)finishTest(id,'error',(e as Error).message)}
}
async function checkTests(){
 if(checkingTests)return
 const pending=Object.entries(tests.value).filter(([,result])=>result.status==='queued')
 if(!pending.length)return
 checkingTests=true
 let completed=false
 try{
  await Promise.all(pending.map(async([value])=>{
   const id=Number(value)
   try{
    const key=await store.fetchKey(id)
    if(!mounted)return
    const state=key.usage_sync
    if(state?.last_status==='success'){finishTest(id,'success','密钥校验通过，额度已同步');completed=true}
    else if(state?.last_status==='error'){finishTest(id,'error',state.last_error||'密钥校验失败');completed=true}
    else tests.value[id].message=state?.last_status==='rate_limited'?'上游限流，等待队列重试':state?.last_status==='running'?'正在校验密钥':'等待配额校验队列'
   }catch(e){if(mounted){finishTest(id,'error',(e as Error).message);completed=true}}
  }))
  if(completed&&mounted)await load(true)
 }finally{checkingTests=false}
}
let request=0, timer:ReturnType<typeof setInterval>|undefined, searchTimer:ReturnType<typeof setTimeout>|undefined
async function load(silent=false){const seq=++request;if(!silent)loading.value=true;try{
 await store.fetchKeys({provider:provider.value,page:page.value,limit:pageSize.value,...(keyword.value.trim()?{keyword:keyword.value.trim()}:{}),...(status.value==='all'?{}:{status:status.value})})
 if(seq===request && page.value!==store.currentPage)page.value=store.currentPage
}catch(e){if(seq===request)toast.error((e as Error).message)}finally{if(seq===request)loading.value=false}}
function clearSelection(){selected.value=[];table.value?.clearSelection()}
watch([provider,status,pageSize,page],(next,old)=>{clearSelection();if(next.slice(0,3).some((v,i)=>v!==old[i])&&page.value!==1){page.value=1;return}void load()})
watch(keyword,()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{clearSelection();if(page.value!==1)page.value=1;else void load()},250)})
async function action(fn:()=>Promise<any>,message?:string){busy.value=true;try{await fn();if(message)toast.success(message);await load();clearSelection()}catch(e){toast.error((e as Error).message)}finally{busy.value=false}}
async function remove(id:number){try{await ElMessageBox.confirm('删除这个密钥？历史请求记录会保留。','删除密钥',{confirmButtonText:'删除',cancelButtonText:'取消',type:'warning'});await action(()=>store.deleteKey(id),'密钥已删除')}catch{/* Cancelled. */}}
async function removeSelected(){
 if(busy.value||!ids.value.length)return
 const selectedIds=[...ids.value], selectedProvider=provider.value
 busy.value=true
 try{
  await ElMessageBox.confirm(`确认删除选中的 ${selectedIds.length} 个 ${selectedProvider==='tavily'?'Tavily':'Exa'} 密钥？此操作无法撤销，历史请求日志和费用记录会保留。`,'批量删除密钥',{
   confirmButtonText:`删除 ${selectedIds.length} 个密钥`,cancelButtonText:'取消',confirmButtonClass:'el-button--danger',type:'warning',closeOnClickModal:false,
  })
  await action(async()=>{const deleted=await store.batchDelete(selectedIds,selectedProvider);toast.success(`已删除 ${deleted} 个密钥`)})
 }catch{/* Confirmation cancelled; keep the selection. */}finally{busy.value=false}
}
async function add(payload:{keys:string[]}){adding.value=true;try{const count=await store.importKeys(payload.keys,provider.value);toast.success(`已添加 ${count} 个，重复 ${payload.keys.length-count} 个`);showAdd.value=false;await load()}catch(e){toast.error((e as Error).message)}finally{adding.value=false}}
async function syncSelected(){await action(async()=>{const data=await store.batchTest(ids.value);toast.success(`已加入 ${data.enqueued} 个同步任务`)})}
onMounted(()=>{void load();testTimer=setInterval(()=>{void checkTests()},2000);timer=setInterval(async()=>{if(provider.value!=='tavily'||busy.value||selected.value.length)return;try{const state=await store.fetchUsageSyncStatus();if(state.running||state.pending)void load(true)}catch{}},10000)})
onUnmounted(()=>{mounted=false;request++;clearInterval(timer);clearInterval(testTimer);clearTimeout(searchTimer)})
</script>
<template>
  <div class="list-view">
    <div class="list-toolbar">
      <el-radio-group v-model="provider"><el-radio-button value="tavily">Tavily</el-radio-button><el-radio-button value="exa">Exa</el-radio-button></el-radio-group>
      <el-input v-model="keyword" clearable :prefix-icon="Search" placeholder="备注、密钥尾号或 ID" class="list-search"/>
      <el-select v-model="status" aria-label="密钥状态" style="width:145px"><el-option label="全部状态" value="all"/><el-option label="可用" value="active"/><el-option label="已停用" value="disabled"/><el-option label="额度暂停" value="quota_exceeded"/><el-option label="密钥失效" value="banned"/></el-select>
      <div class="toolbar-end"><el-button :icon="Refresh" :loading="loading" @click="load()">刷新</el-button><el-button type="primary" :icon="Plus" @click="showAdd=true">新增密钥</el-button></div>
    </div>
    <section class="panel list-panel">
      <div v-if="ids.length" class="selection-bar"><span>已选 {{ ids.length }} 项</span><el-button size="small" :disabled="busy" @click="action(()=>store.batchEnable(ids),'已启用')">启用</el-button><el-button size="small" :disabled="busy" @click="action(()=>store.batchDisable(ids),'已停用')">停用</el-button><el-button v-if="provider==='tavily'" size="small" :disabled="busy" @click="syncSelected">同步配额</el-button><el-button size="small" type="danger" plain :disabled="busy" @click="removeSelected">批量删除</el-button><el-button link :disabled="busy" @click="clearSelection">取消选择</el-button></div>
      <KeyTable ref="table" :key="provider" :keys="store.keys" :loading="loading" :provider="provider" :tests="tests" @test="testKey" @selection-change="selected=$event"
        @enable="id=>action(()=>store.enableKey(id),'已启用')" @disable="id=>action(()=>store.disableKey(id),'已停用')"
        @reset="id=>action(()=>store.resetErrors(id),'错误计数已重置')" @delete="remove" @billing="billingKey=$event"
        @update-name="(id,name)=>action(()=>store.updateKey(id,{display_name:name}))" @update-weight="(id,weight)=>action(()=>store.updateKey(id,{weight}))"/>
      <TablePagination v-model:page="page" v-model:page-size="pageSize" :total="store.total"/>
    </section>
    <AddKeyDialog v-model="showAdd" :loading="adding" :provider="provider" @submit="add"/>
    <ExaBillingDialog :key-id="billingKey" @close="billingKey=null" @saved="load()"/>
  </div>
</template>
