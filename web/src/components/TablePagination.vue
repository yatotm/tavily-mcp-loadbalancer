<script setup lang="ts">
const props = defineProps<{ page: number; pageSize: number; total: number }>()
const emit = defineEmits<{ (e:'update:page', value:number):void; (e:'update:pageSize', value:number):void }>()
function resize(value:number) { emit('update:pageSize', value); emit('update:page', 1) }
</script>
<template>
  <div class="table-pagination">
    <span>{{ total ? (page - 1) * pageSize + 1 : 0 }}–{{ Math.min(page * pageSize, total) }} / {{ total }} 条</span>
    <div class="pagination-controls">
      <el-select :model-value="pageSize" aria-label="每页条数" class="page-size-select" @change="resize"><el-option v-for="size in [10,20,50,100]" :key="size" :value="size" :label="`${size} 条 / 页`" /></el-select>
      <el-pagination :current-page="props.page" :page-size="props.pageSize" :total="props.total" :pager-count="5" layout="prev, pager, next, jumper" @update:current-page="emit('update:page',$event)" />
    </div>
  </div>
</template>
