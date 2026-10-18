/**
 * 一键运行 V3.0 端到端验证：
 *   1. 清空 .verify/data，保证每次从干净数据库开始
 *   2. 用 esbuild 打包 tools/verify-v3.ts
 *   3. 依次执行 init / inject / run 三个独立进程
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const dataDir = path.join(projectRoot, '.verify', 'data')
const outfile = path.join(projectRoot, 'out', 'verify', 'verify.mjs')

fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(path.dirname(outfile), { recursive: true })

await build({
  entryPoints: [path.join(projectRoot, 'tools', 'verify-v3.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: ['sql.js', 'nodemailer'],
  logLevel: 'warning',
})

for (const step of ['init', 'inject', 'run']) {
  console.log(`\n[verify] ${step}`)
  const result = spawnSync(process.execPath, [outfile, step], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env },
  })
  if (result.status !== 0) {
    console.error(`[verify] 步骤 ${step} 失败（exit ${result.status}）`)
    process.exit(result.status ?? 1)
  }
}

console.log('\n[verify] 完成')
