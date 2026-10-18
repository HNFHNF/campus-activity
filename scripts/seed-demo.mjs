/** 打包并写入截图/演示用的干净数据库（.screenshots/demo）。 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const dataDir = path.join(projectRoot, '.screenshots', 'demo')
const outfile = path.join(projectRoot, 'out', 'seed', 'seed-demo.mjs')

fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(path.dirname(outfile), { recursive: true })

await build({
  entryPoints: [path.join(projectRoot, 'tools', 'seed-demo.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: ['sql.js', 'nodemailer'],
  logLevel: 'warning',
})

for (const step of ['init', 'inject']) {
  const result = spawnSync(process.execPath, [outfile, step], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env },
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
