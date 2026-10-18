/**
 * 一键生成 V3.0 演示截图：
 *   1. 构建网页版（npm run web:build）
 *   2. 写入 .screenshots/demo 演示数据库（npm run seed:demo）
 *   3. 用该数据目录启动 out/web/server.mjs
 *   4. 调用 tools/shots.mjs 驱动 Edge/Chrome 截图
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.SHOT_PORT ?? 5199)
const dataDir = path.join(projectRoot, '.screenshots', 'demo')
const analysisCandidates = [
  path.resolve(projectRoot, '..', 'analysis'),
  path.join(projectRoot, 'docs', 'analysis'),
  path.join(projectRoot, 'analysis'),
]
const analysisRoot = analysisCandidates.find(candidate => fs.existsSync(candidate)) ?? analysisCandidates[1]
const outDir = path.join(analysisRoot, 'screenshots')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(command, args, options = {}) {
  const useShell = options.shell ?? command.endsWith('.cmd')
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit', shell: useShell, ...options, shell: useShell })
  if (result.status !== 0) {
    console.error(`命令失败：${command} ${args.join(' ')}`)
    process.exit(result.status ?? 1)
  }
}

if (!fs.existsSync(path.join(projectRoot, 'out', 'web', 'server.mjs'))) {
  run(npm, ['run', 'web:build'])
}

run(npm, ['run', 'seed:demo'])

const server = spawn(process.execPath, [path.join(projectRoot, 'out', 'web', 'server.mjs')], {
  cwd: projectRoot,
  stdio: 'ignore',
  env: {
    ...process.env,
    PORT: String(port),
    CAMPUS_PROJECT_ROOT: projectRoot,
    CAMPUS_DATA_DIR: dataDir,
  },
})

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (response.ok) return
    } catch { /* 尚未就绪 */ }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error('网页版服务未启动')
}

try {
  await waitForServer()
  run(process.execPath, [path.join(projectRoot, 'tools', 'shots.mjs'), `http://127.0.0.1:${port}`, outDir])
} finally {
  server.kill()
}
