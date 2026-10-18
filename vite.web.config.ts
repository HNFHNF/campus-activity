/**
 * 网页版（浏览器）渲染进程的 Vite 配置。
 * Electron 模式仍然使用 electron.vite.config.ts。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const apiPort = Number(process.env.PORT ?? 5174)

export default defineConfig({
  root: projectRoot,
  plugins: [vue()],
  server: {
    // 明确监听 IPv4 回环地址，避免只绑定 ::1 导致浏览器访问 127.0.0.1 被拒绝
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5180),
    strictPort: true,
    // 浏览器里前端和 API 同源，开发期由 Vite 代理到本地 API 服务
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
      },
    },
  },
  build: {
    outDir: 'out/web/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('index.html', import.meta.url)),
    },
  },
})
