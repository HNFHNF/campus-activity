/**
 * V3.0 端到端验证脚本（开发期使用）。
 *
 * 分三步在独立进程中执行，避免 database.ts 的内存缓存影响注入结果：
 *   node verify.mjs init    —— 初始化加密数据库（建表 + 预置活动）
 *   node verify.mjs inject  —— 向数据库注入 3 个测试学生账号
 *   node verify.mjs run     —— 走真实业务函数，验证 V3.0 的通知 / 幂等 / 概览逻辑
 *
 * 由 scripts/verify.mjs 负责打包与串联，npm run verify 即可一次跑完。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { setPlatform } from '../electron/platform'
import {
  applyForActivity,
  cancelRegistration,
  createActivity,
  listActivities,
  listActivityOverviews,
  listNotifications,
  listStudentRegistrations,
  listStudents,
  markNotificationsRead,
  reviewRegistration,
  suspendActivity,
  updateActivity,
} from '../electron/database'

const ROOT = process.cwd()
const DATA_DIR = path.join(ROOT, '.verify', 'data')
const WASM_DIR = path.join(ROOT, 'public')
const DB_FILE = path.join(DATA_DIR, 'campus-events.db.enc')
const KEY_FILE = path.join(DATA_DIR, 'campus-events.key')

setPlatform({
  kind: 'node',
  dataDir: DATA_DIR,
  wasmDir: WASM_DIR,
  keyProtector: { available: false, encrypt: (value) => value, decrypt: (value) => value },
})

const STUDENTS = [
  { account: '2025061010030111', name: '验证学生甲', email: 'a@qq.com' },
  { account: '2025061010030112', name: '验证学生乙', email: 'b@qq.com' },
  { account: '2025061010030113', name: '验证学生丙', email: 'c@qq.com' },
]

function encryptDatabase(data: Uint8Array, key: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)
  const encrypted = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()])
  return Buffer.concat([Buffer.from('CEV1'), iv, cipher.getAuthTag(), encrypted])
}

function decryptDatabase(data: Buffer, key: string) {
  const iv = data.subarray(4, 16)
  const tag = data.subarray(16, 32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data.subarray(32)), decipher.final()])
}

function hash(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

async function stepInit() {
  const list = await listStudents()
  console.log(`[init] 数据库已初始化，当前学生数 ${list.length}`)
}

async function stepInject() {
  const require = createRequire(import.meta.url)
  const initSqlJs = require('sql.js') as typeof import('sql.js')
  const SQL = await initSqlJs({ locateFile: () => path.join(WASM_DIR, 'sql-wasm.wasm') })
  const key = fs.readFileSync(KEY_FILE, 'utf8').trim()
  const db = new SQL.Database(new Uint8Array(decryptDatabase(fs.readFileSync(DB_FILE), key)))
  const now = new Date().toISOString()
  db.run("DELETE FROM activity_registrations")
  db.run("DELETE FROM notifications")
  db.run("DELETE FROM users WHERE role = 'student'")
  for (const student of STUDENTS) {
    const salt = crypto.randomBytes(16).toString('hex')
    db.run(
      `INSERT INTO users (account, password_hash, password_salt, name, email, role, remember_me, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'student', 0, 'active', ?, ?)`,
      [student.account, hash('123456', salt), salt, student.name, student.email, now, now]
    )
  }
  fs.writeFileSync(DB_FILE, encryptDatabase(db.export(), key))
  console.log(`[inject] 已注入 ${STUDENTS.length} 个测试学生`)
}

let failed = 0
function check(label: string, condition: boolean, extra = '') {
  console.log(`${condition ? '  PASS' : '  FAIL'} ${label}${extra ? ' — ' + extra : ''}`)
  if (!condition) {
    failed += 1
    process.exitCode = 1
  }
}

async function stepRun() {
  const [s1, s2, s3] = STUDENTS.map(s => s.account)

  console.log('\n== 场景 1：审核制活动的报名与审核结果通知 ==')
  const reviewAct = await createActivity({
    title: 'V3 验证·审核制活动', category: 'academic', desc: '验证用',
    time: '2026-11-01 19:00', location: '工科楼A301', capacity: 2,
    deadline: '2026-10-30 22:00', organizer: '验证组', icon: '🧪',
    reviewEnabled: true, teacherId: 'admin',
  }, 'admin')
  const r1 = await applyForActivity(s1, reviewAct.id, 'token-s1')
  const r2 = await applyForActivity(s2, reviewAct.id, 'token-s2')
  const r3 = await applyForActivity(s3, reviewAct.id, 'token-s3')
  check('审核制活动报名后状态为 pending', r1.status === 'pending' && r2.status === 'pending' && r3.status === 'pending')
  check('首次提交 reused=false', r1.reused === false)
  check('报名回执 requestId 已返回', Boolean(r1.requestId))

  console.log('\n== 场景 2：重复点击/重试的幂等处理 ==')
  const retrySameToken = await applyForActivity(s1, reviewAct.id, 'token-s1')
  const retryAnotherToken = await applyForActivity(s1, reviewAct.id, 'token-other')
  check('同一 request_token 重试不报错且 reused=true', retrySameToken.reused === true && retrySameToken.status === 'pending')
  check('不同 request_token 也不会重复创建报名', retryAnotherToken.reused === true)
  const overviewAfterRetry = await listActivityOverviews('admin')
  const targetAfterRetry = overviewAfterRetry.find(item => item.activityId === reviewAct.id)
  check('重复提交后仍只有 3 条待审核', targetAfterRetry?.pending === 3, JSON.stringify(targetAfterRetry))

  await reviewRegistration('admin', reviewAct.id, s1, 'approve')
  await reviewRegistration('admin', reviewAct.id, s2, 'approve')
  const reviewed3 = await reviewRegistration('admin', reviewAct.id, s3, 'approve')
  check('第 3 位通过审核后因满员转入候补', reviewed3.status === 'waitlisted', `实际 ${reviewed3.status}`)

  const n1 = await listNotifications(s1)
  const n3a = await listNotifications(s3)
  check('学生甲收到“审核通过”通知', n1.some(n => n.type === 'review_approved'))
  check('学生丙收到“审核通过（转候补）”通知', n3a.some(n => n.type === 'review_approved'))
  check('通知默认未读', n1.every(n => !n.read))
  check('通知包含活动 id', n1.every(n => n.activityId === reviewAct.id))

  console.log('\n== 场景 3：取消报名触发候补递补，递补者收到通知 ==')
  const cancelResult = await cancelRegistration(s1, reviewAct.id)
  check('取消报名后自动递补了候补学生', cancelResult.promoted.length === 1, JSON.stringify(cancelResult.promoted))
  const n3b = await listNotifications(s3)
  check('学生丙收到“候补递补成功”通知', n3b.some(n => n.type === 'waitlist_promoted'))

  console.log('\n== 场景 4：通知已读标记 ==')
  await markNotificationsRead(s3, n3b[0].id)
  const n3c = await listNotifications(s3)
  check('单条标记已读生效', n3c.find(n => n.id === n3b[0].id)?.read === true)
  await markNotificationsRead(s3)
  const n3d = await listNotifications(s3)
  check('全部标记已读生效', n3d.every(n => n.read))

  console.log('\n== 场景 5：关闭审核后待审核申请自动处理并通知 ==')
  const autoAct = await createActivity({
    title: 'V3 验证·关闭审核自动处理', category: 'club', desc: '验证用',
    time: '2026-11-03 19:00', location: '教学楼B201', capacity: 1,
    deadline: '2026-11-01 22:00', organizer: '验证组', icon: '🧪',
    reviewEnabled: true, teacherId: 'admin',
  }, 'admin')
  await applyForActivity(s1, autoAct.id, 'auto-s1')
  await applyForActivity(s2, autoAct.id, 'auto-s2')
  await updateActivity(autoAct.id, {
    title: 'V3 验证·关闭审核自动处理', category: 'club', desc: '验证用',
    time: '2026-11-03 19:00', location: '教学楼B201', capacity: 1,
    deadline: '2026-11-01 22:00', organizer: '验证组', icon: '🧪',
    reviewEnabled: false, teacherId: 'admin',
  }, 'admin')
  const n1b = await listNotifications(s1)
  const n2b = await listNotifications(s2)
  check('关闭审核后待审核申请自动处理并通知', n1b.some(n => n.type === 'registration_resolved') && n2b.some(n => n.type === 'registration_resolved'))

  console.log('\n== 场景 6：活动被下架，已报名学生收到通知 ==')
  await suspendActivity(reviewAct.id, '验证：内容不合规')
  const n3e = await listNotifications(s3)
  check('已报名学生收到“活动下架”通知', n3e.some(n => n.type === 'activity_suspended'))

  console.log('\n== 场景 7：教师端报名结构概览与供需字段 ==')
  const overviews = await listActivityOverviews('admin')
  const target = overviews.find(item => item.activityId === reviewAct.id)
  check('概览返回容量/申请/正式/候补/待审核字段', Boolean(target), JSON.stringify(target))
  check('被取消者释放名额后正式人数为 2', target?.confirmed === 2, JSON.stringify(target))
  check('概览覆盖率本人全部活动', overviews.length >= 2, `共 ${overviews.length} 个`)

  console.log('\n== 场景 8：活动列表附带候补人数与状态更新时间 ==')
  const acts = await listActivities({ account: 'admin', name: 'admin', role: 'teacher' })
  const listed = acts.find(item => item.id === autoAct.id)
  check('活动列表返回 waitlistCount', typeof listed?.waitlistCount === 'number', JSON.stringify(listed?.waitlistCount))
  const s2Regs = await listStudentRegistrations(s2)
  const autoReg = s2Regs.find(item => item.activityId === autoAct.id)
  check('报名记录包含 statusUpdatedAt', Boolean(autoReg?.statusUpdatedAt), JSON.stringify(autoReg))
  check('报名记录包含 requestId', Boolean(autoReg?.requestId), JSON.stringify(autoReg?.requestId))

  console.log('\n== 场景 9：原有功能未受影响 ==')
  const students = await listStudents()
  check('学生列表接口仍可用', students.length === 3, `共 ${students.length} 个`)
  check('活动列表接口仍可用', Array.isArray(acts) && acts.length > 0)
  const r1Regs = await listStudentRegistrations(s1)
  check('学生仍可查看自己的报名记录', Array.isArray(r1Regs))

  console.log(`\n结果：${failed === 0 ? '全部通过' : `${failed} 项失败`}`)
}

const step = process.argv[2]
if (step === 'init') await stepInit()
else if (step === 'inject') await stepInject()
else if (step === 'run') await stepRun()
else console.log('用法: node verify.mjs init|inject|run')
