import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { useStore } from './composables/useStore'

const { showToast } = useStore()

// 未捕获的异常也在界面上提示，避免出现"点了按钮没反应"却没有任何反馈
window.addEventListener('error', (event) => {
  showToast(event.message || '页面发生异常，请重试')
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  showToast(reason instanceof Error ? reason.message : String(reason ?? '操作失败，请重试'))
})

createApp(App).mount('#app').$nextTick(() => {
  // Use contextBridge —— 只有 Electron 窗口里存在该桥接对象，浏览器版本没有主进程推送
  window.ipcRenderer?.on('main-process-message', (_event, message) => {
    console.log(message)
  })
})
