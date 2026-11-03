// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import TablePagination from '../TablePagination.vue'

describe('table pagination', () => {
  it('emits page changes to the owner and resets the page when resizing', async () => {
    const wrapper = mount(defineComponent({
      components: { TablePagination },
      setup: () => ({ page: ref(2), size: ref(20) }),
      template: '<TablePagination v-model:page="page" v-model:page-size="size" :total="65"/>',
    }), { global: { stubs: {
      ElPagination: defineComponent({ props: ['currentPage','pageSize','total'], emits: ['update:current-page'], template: '<button @click="$emit(\'update:current-page\',3)">Next</button>' }),
      ElSelect: defineComponent({ props: ['modelValue'], emits: ['change'], template: '<button @click="$emit(\'change\',50)">Resize</button>' }),
      ElOption: true,
    } } })
    expect(wrapper.text()).toContain('21–40 / 65 条')
    await wrapper.get('button:last-child').trigger('click')
    expect(wrapper.text()).toContain('41–60 / 65 条')
    await wrapper.get('button:first-child').trigger('click')
    expect(wrapper.text()).toContain('1–50 / 65 条')
    expect(wrapper.vm.page).toBe(1)
    expect(wrapper.vm.size).toBe(50)
  })
})
