import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './styles/global.css'
import './styles/element-overrides.css'
import './styles/gateway.css'
import App from './App.vue'

const app = createApp(App)
app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')
