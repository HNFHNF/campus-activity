/**
 * 网页版（浏览器）使用的本地 API 服务。
 *
 * - 只监听 127.0.0.1，不对外网开放；
 * - 接口路径为 POST /api/<通道名>，与 Electron 的 IPC 通道一一对应；
 * - 数据库复用 electron/database.ts，默认存放在 <项目根目录>/data。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getChannelHandler } from '../electron/channels'
import { setPlatform } from '../electron/platform'
import { resolveActor } from '../electron/session'

const projectRoot = path.resolve(process.env.CAMPUS_PROJECT_ROOT ?? process.cwd())
const port = Number(process.env.PORT ?? 5174)
const host = process.env.HOST ?? '127.0.0.1'
const dataDir = path.resolve(process.env.CAMPUS_DATA_DIR ?? path.join(projectRoot, 'data'))
const staticDir = path.resolve(process.env.CAMPUS_WEB_ROOT ?? path.join(projectRoot, 'out', 'web', 'renderer'))

function resolveWasmDir() {
  const candidates = [
    process.env.CAMPUS_WASM_DIR,
    path.join(projectRoot, 'public'),
    path.join(projectRoot, 'node_modules', 'sql.js', 'dist'),
  ].filter((dir): dir is string => Boolean(dir))

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'sql-wasm.wasm'))) return path.resolve(dir)
  }
  throw new Error('未找到 sql-wasm.wasm，请先执行 npm install 安装依赖')
}

const wasmDir = resolveWasmDir()

setPlatform({
  kind: 'node',
  dataDir,
  wasmDir,
  // 浏览器版本面向本机使用：没有操作系统的密钥保护服务，密钥文件以明文保存在 data 目录
  keyProtector: {
    available: false,
    encrypt: (plain) => plain,
    decrypt: (value) => value,
  },
})

fs.mkdirSync(dataDir, { recursive: true })

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

function readBody(req: IncomingMessage, limit = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求内容过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function serveStatic(res: ServerResponse, pathname: string) {
  if (!fs.existsSync(staticDir)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('网页版界面尚未构建。开发时请运行 npm run web，构建后请运行 npm run web:build。')
    return
  }

  const relative = decodeURIComponent(pathname).replace(/^\/+/, '')
  const target = path.resolve(staticDir, relative || 'index.html')
  if (target !== staticDir && !target.startsWith(staticDir + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('禁止访问该路径')
    return
  }

  const filePath = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(staticDir, 'index.html')
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('页面不存在')
    return
  }

  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  })
  fs.createReadStream(filePath).pipe(res)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`)

    if (url.pathname === '/api/health') {
      sendJson(res, 200, { result: { ok: true, runtime: 'web', dataDir } })
      return
    }

    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: '该接口只接受 POST 请求' })
        return
      }

      const channel = decodeURIComponent(url.pathname.slice('/api/'.length))
      const handler = getChannelHandler(channel)
      if (!handler) {
        sendJson(res, 404, { error: `未知接口：${channel}` })
        return
      }

      let request: { token?: string; payload?: unknown } = {}
      try {
        const body = await readBody(req)
        request = body ? (JSON.parse(body) as { token?: string; payload?: unknown }) : {}
      } catch {
        sendJson(res, 400, { error: '请求内容不是合法的 JSON' })
        return
      }

      const token = typeof request?.token === 'string' ? request.token : null
      try {
        sendJson(res, 200, { result: (await handler(request?.payload ?? null, { actor: resolveActor(token), token })) ?? null })
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : '请求处理失败' })
      }
      return
    }

    serveStatic(res, url.pathname)
  } catch (error) {
    console.error('[web] 未处理的异常:', error)
    sendJson(res, 500, { error: '服务器内部错误' })
  }
})

server.listen(port, host, () => {
  console.log(`[web] 网页版服务已启动：http://${host}:${port}`)
  console.log(`[web] 数据文件目录：${dataDir}`)
  console.log('[web] 浏览器版本未经系统密钥保护，密钥文件以明文保存在 data 目录，仅供本机使用')
})
