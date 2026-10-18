/**
 * 一条命令启动网页版开发环境：
 *   1. 用 esbuild 把 server/index.ts 打包成 out/web/server.mjs（监听改动并自动重启）
 *   2. 启动本地 API 服务（默认 127.0.0.1:5174）
 *   3. 启动 Vite 开发服务器（默认 5173，/api 自动代理到 API 服务）
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { context } from 'esbuild'
import { createServer } from 'vite'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const serverOutfile = path.join(projectRoot, 'out', 'web', 'server.mjs')
const apiPort = process.env.PORT ?? '5174'
const webPort = Number(process.env.WEB_PORT ?? 5180)

let apiProcess
let stopping = false
let restartTimer

function startApi() {
  apiProcess = spawn(process.execPath, [serverOutfile], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, PORT: apiPort, CAMPUS_PROJECT_ROOT: projectRoot },
  })

  apiProcess.on('exit', (code) => {
    apiProcess = undefined
    if (stopping) return
    console.log(`[web] API 服务已退出（code ${code}），3 秒后重启`)
    restartTimer = setTimeout(startApi, 3000)
  })
}

function restartApi() {
  if (stopping) return
  clearTimeout(restartTimer)
  if (!apiProcess) {
    startApi()
    return
  }
  const previous = apiProcess
  apiProcess = undefined
  previous.once('exit', () => {
    if (!stopping) startApi()
  })
  previous.kill()
}

const buildContext = await context({
  entryPoints: [path.join(projectRoot, 'server', 'index.ts')],
  outfile: serverOutfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: ['sql.js', 'nodemailer'],
  logLevel: 'warning',
  plugins: [
    {
      name: 'restart-api-on-rebuild',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) return
          restartApi()
        })
      },
    },
  ],
})

await buildContext.watch()

const viteServer = await createServer({
  configFile: path.join(projectRoot, 'vite.web.config.ts'),
  server: { port: webPort },
})
await viteServer.listen()

console.log(`[web] 网页版地址：http://127.0.0.1:${viteServer.config.server.port ?? webPort}`)
console.log('[web] 直接在浏览器打开上面的地址即可，界面与桌面版完全一致')
console.log('[web] 按 Ctrl+C 结束全部进程')

async function shutdown() {
  if (stopping) return
  stopping = true
  clearTimeout(restartTimer)
  apiProcess?.kill()
  await viteServer.close().catch(() => {})
  await buildContext.dispose().catch(() => {})
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
