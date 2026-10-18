/**
 * 通过 Chrome DevTools Protocol 驱动本机 Edge/Chrome，为 V3.0 网页版截图。
 * 仅使用 Node 内置模块（fetch + WebSocket），不依赖 Playwright/Puppeteer。
 *
 * 用法：node tools/shots.mjs [baseUrl] [outDir]
 * 前置：先运行 npm run web:build && npm run seed:demo，
 *       再用 .screenshots/demo 作为数据目录启动 out/web/server.mjs。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function defaultOutputDir() {
  // 交付包布局：campus-activity-main/ 与 analysis/ 同级；扁平仓库布局：docs/analysis/
  const candidates = [
    path.resolve(APP_ROOT, '..', 'analysis'),
    path.join(APP_ROOT, 'docs', 'analysis'),
    path.join(APP_ROOT, 'analysis'),
  ]
  const base = candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[1]
  return path.join(base, 'screenshots')
}

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
const CHROME = process.env.DSH_BROWSER ?? BROWSERS.find(item => fs.existsSync(item))
const BASE = process.argv[2] ?? 'http://127.0.0.1:5199'
const OUT = path.resolve(process.argv[3] ?? defaultOutputDir())
const PORT = Number(process.env.CDP_PORT ?? 9333)
const STUDENT = { account: '2025061010030119', password: '123456' }
const TEACHER = { account: 'admin', password: '123456' }

if (!CHROME) {
  console.error('未找到 Edge/Chrome，请通过环境变量 DSH_BROWSER 指定浏览器路径')
  process.exit(1)
}
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const userDataDir = path.join(os.tmpdir(), `cdp-shots-${Date.now()}`)
const browser = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--hide-scrollbars', '--window-size=1440,960',
  'about:blank',
], { stdio: 'ignore' })

async function waitForDevtools() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (response.ok) return
    } catch { /* 尚未就绪 */ }
    await sleep(400)
  }
  throw new Error('DevTools 未就绪')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    const cdp = new Cdp(ws)
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && cdp.pending.has(message.id)) {
        const { resolve, reject } = cdp.pending.get(message.id)
        cdp.pending.delete(message.id)
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
      }
    })
    return cdp
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

const SET_VALUE = `(sel, value) => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}`

const CLICK_TEXT = `(text, selector) => {
  const nodes = [...document.querySelectorAll(selector || '.nav-item, .mobile-nav-item, button, a, .chip, .quick-chip, label, .status-tab')];
  const target = nodes.find(node => node.textContent.trim().includes(text));
  if (!target) return false;
  target.click();
  return true;
}`

const CLICK_CARD = `(title) => {
  const cards = [...document.querySelectorAll('.activity-card')];
  const target = cards.find(card => card.textContent.includes(title));
  if (!target) return false;
  target.click();
  return true;
}`

async function main() {
  await waitForDevtools()
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find(target => target.type === 'page')
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const evaluate = async (fn, ...args) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`,
      awaitPromise: true,
      returnByValue: true,
    })
    return result.result?.value
  }

  const screenshot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'))
    console.log('  ✔', name)
  }

  const resize = async (width, height) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 700,
    })
  }

  const login = async (account, password, role = 'student') => {
    if (role === 'teacher') await evaluate(CLICK_TEXT, '教师 / 管理员')
    await sleep(300)
    const filledAccount = await evaluate(SET_VALUE, 'input.input[type="text"]', account)
    const filledPassword = await evaluate(SET_VALUE, 'input[type="password"]', password)
    if (!filledAccount || !filledPassword) throw new Error('登录表单未找到')
    await sleep(200)
    await evaluate(`() => { document.querySelector('button[type="submit"]').click(); return true }`)
    await sleep(2200)
  }

  const openView = async (label) => {
    const clicked = await evaluate(CLICK_TEXT, label)
    if (!clicked) throw new Error(`未找到导航：${label}`)
    await sleep(1200)
  }

  const closeModal = async () => {
    await evaluate(`() => { document.querySelector('.modal-close')?.click(); return true }`)
    await sleep(600)
  }

  const scrollModalToBottom = async () => {
    await evaluate(`() => { const body = document.querySelector('.modal-body'); if (body) body.scrollTop = body.scrollHeight; return true }`)
    await sleep(400)
  }

  await resize(1440, 960)
  await cdp.send('Page.navigate', { url: BASE })
  await sleep(2600)
  await screenshot('01-登录页.png')

  // 学生端
  await login(STUDENT.account, STUDENT.password)
  await sleep(800)
  await screenshot('02-活动广场.png')

  await evaluate(CLICK_TEXT, '仅看有名额')
  await sleep(700)
  await screenshot('03-活动广场-筛选与快捷条件.png')
  await evaluate(CLICK_TEXT, '清除筛选')
  await sleep(500)

  // 满员/候补活动详情：展示候补人数与同类备选
  await evaluate(CLICK_CARD, '草地音乐节')
  await sleep(900)
  await scrollModalToBottom()
  await screenshot('04-活动详情-候补与同类备选.png')
  await closeModal()

  // 未报名活动提交报名：展示“提交中/回执/防重复”
  await evaluate(CLICK_CARD, '周末读书交流')
  await sleep(900)
  await evaluate(CLICK_TEXT, '立即报名', 'button')
  await sleep(1500)
  await scrollModalToBottom()
  await screenshot('05-活动详情-报名回执.png')
  await sleep(2400)
  await closeModal()

  await openView('我的活动')
  await screenshot('06-我的活动-冲突与状态筛选.png')

  await openView('通知中心')
  await screenshot('07-通知中心.png')

  // 移动端：重新加载后重新登录，验证底部导航与窄屏布局
  await resize(390, 844)
  await cdp.send('Page.navigate', { url: BASE })
  await sleep(2000)
  await screenshot('08-移动端-登录页.png')
  await login(STUDENT.account, STUDENT.password)
  await sleep(900)
  await screenshot('09-移动端-活动广场.png')
  await openView('我的')
  await screenshot('10-移动端-我的活动.png')
  await openView('通知')
  await screenshot('11-移动端-通知中心.png')

  // 教师端
  await resize(1440, 960)
  await cdp.send('Page.navigate', { url: BASE })
  await sleep(1800)
  await login(TEACHER.account, TEACHER.password, 'teacher')
  await openView('活动管理')
  await sleep(800)
  await screenshot('12-教师端-活动管理概览.png')

  browser.kill()
  console.log('完成，输出目录：', OUT)
}

main().catch((error) => {
  console.error('截图失败：', error.message)
  browser.kill()
  process.exit(1)
})
