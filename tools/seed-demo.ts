/**
 * 为 V3.0 网页版准备演示数据（开发/截图用，不参与业务逻辑）。
 *
 *   node seed-demo.mjs init    —— 初始化加密数据库
 *   node seed-demo.mjs inject  —— 写入演示学生、活动、报名与通知
 *
 * 由 scripts/seed-demo.mjs 打包并串联；数据只用于本机演示与截图，
 * 不会被当作 V3.0 的真实运行数据，也不影响默认的 %APPDATA% 数据库。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { setPlatform } from '../electron/platform'
import { listStudents } from '../electron/database'

const ROOT = process.cwd()
const DATA_DIR = path.join(ROOT, '.screenshots', 'demo')
const WASM_DIR = path.join(ROOT, 'public')
const DB_FILE = path.join(DATA_DIR, 'campus-events.db.enc')
const KEY_FILE = path.join(DATA_DIR, 'campus-events.key')

setPlatform({
  kind: 'node',
  dataDir: DATA_DIR,
  wasmDir: WASM_DIR,
  keyProtector: { available: false, encrypt: (value) => value, decrypt: (value) => value },
})

function decryptDatabase(data: Buffer, key: string) {
  const iv = data.subarray(4, 16)
  const tag = data.subarray(16, 32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data.subarray(32)), decipher.final()])
}

function encryptDatabase(data: Uint8Array, key: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)
  const encrypted = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()])
  return Buffer.concat([Buffer.from('CEV1'), iv, cipher.getAuthTag(), encrypted])
}

const hash = (password: string, salt: string) => crypto.scryptSync(password, salt, 64).toString('hex')

function localTime(daysFromNow: number, clock: string): string {
  const date = new Date()
  date.setDate(date.getDate() + daysFromNow)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString()
}

async function init() {
  await listStudents()
  console.log('[seed] 数据库已初始化')
}

async function inject() {
  const require = createRequire(import.meta.url)
  const initSqlJs = require('sql.js') as typeof import('sql.js')
  const SQL = await initSqlJs({ locateFile: () => path.join(WASM_DIR, 'sql-wasm.wasm') })
  const key = fs.readFileSync(KEY_FILE, 'utf8').trim()
  const db = new SQL.Database(new Uint8Array(decryptDatabase(fs.readFileSync(DB_FILE), key)))

  db.run('DELETE FROM activity_registrations')
  db.run('DELETE FROM notifications')
  db.run('DELETE FROM activities')
  db.run("DELETE FROM users WHERE role = 'student'")

  const activities = [
    [9001, '秋季校园马拉松', 'sports', '5 公里趣味跑，设置个人挑战组与团队接力组，完赛即可获得纪念奖牌。', localTime(3, '19:00'), '东校区田径场', 3, localTime(2, '22:00'), '体育教研部', '🏃', 'admin', 0],
    [9002, '草地音乐节', 'culture', '乐队演出、独立音乐人、自由舞台，欢迎大家自带野餐垫参与。', localTime(3, '19:30'), '西校区大草坪', 2, localTime(2, '22:00'), '音乐社', '🎸', 'admin', 0],
    [9003, 'Python 数据分析工作坊', 'academic', '手把手带你完成一次真实数据的清洗、统计与可视化；名额有限，需组织教师审核。', localTime(4, '14:00'), '工科楼 A301', 1, localTime(3, '22:00'), '计算机学院', '🐍', 'admin', 1],
    [9004, '校园摄影作品展', 'culture', '展出本学年校园摄影大赛优秀作品，现场有作者分享拍摄故事。', localTime(5, '10:00'), '图书馆一层展厅', 40, localTime(4, '22:00'), '摄影协会', '📷', 'admin', 1],
    [9005, '心理健康科普讲座', 'academic', '围绕压力管理与睡眠调节展开的科普讲座，欢迎带着问题来。', localTime(6, '19:00'), '学生活动中心 204', 100, localTime(5, '22:00'), '心理健康中心', '🧠', 'admin', 1],
    [9006, '急救知识体验', 'volunteer', '心肺复苏、AED 使用与常见意外处置的现场体验，完成体验可获得培训证明。', localTime(2, '14:00'), '校园广场', 2, localTime(1, '22:00'), '校医院', '🚑', 'admin', 0],
    [9007, '周末读书交流', 'academic', '围绕本月共读书目展开自由讨论，也欢迎带着自己最近在读的书来交换书单。', localTime(7, '15:00'), '图书馆研讨室 3', 60, localTime(6, '22:00'), '读书协会', '📚', 'admin', 0],
    [9008, '秋日手作市集', 'culture', '现场体验黏土、编织与手账拼贴，也欢迎带上自己的作品来交换。', localTime(8, '14:00'), '学生活动中心 204', 30, localTime(7, '22:00'), '手作社', '🧶', 'admin', 0],
  ]
  for (const activity of activities) {
    db.run(
      `INSERT INTO activities (id, title, category, description, activity_time, location, capacity, enrolled, deadline, organizer, icon, teacher_id, review_enabled, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'active')`,
      activity
    )
  }

  const students = [
    ['2025061010030119', '李意涵'],
    ['2025061010030111', '王梓涵'],
    ['2025061010030112', '陈嘉懿'],
    ['2025061010030113', '周予安'],
    ['2025061010030114', '林书瑶'],
  ]
  const now = new Date().toISOString()
  students.forEach(([account, name], index) => {
    const salt = crypto.randomBytes(16).toString('hex')
    db.run(
      `INSERT INTO users (account, password_hash, password_salt, name, email, role, remember_me, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'student', 0, 'active', ?, ?)`,
      [account, hash('123456', salt), salt, name, `demo${index}@qq.com`, now, now]
    )
  })
  const sid = (account: string) => Number(db.exec('SELECT id FROM users WHERE account = ?', [account])[0].values[0][0])

  // 李意涵：两个同晚活动（时间冲突）、一个候补、一个审核通过、一个审核未通过
  const registrations: Array<[number, string, string, string, string | null, string]> = [
    [9001, students[0][0], 'confirmed', isoHoursAgo(48), 'admin', 'confirmed'],
    [9002, students[0][0], 'confirmed', isoHoursAgo(47), 'admin', 'confirmed'],
    [9003, students[0][0], 'confirmed', isoHoursAgo(30), 'admin', 'waitlist_promoted'],
    [9004, students[0][0], 'confirmed', isoHoursAgo(26), 'admin', 'review_approved'],
    [9006, students[0][0], 'waitlisted', isoHoursAgo(20), null, 'waitlisted'],
    [9005, students[0][0], 'rejected', isoHoursAgo(40), 'admin', 'review_rejected'],
    [9001, students[1][0], 'confirmed', isoHoursAgo(46), 'admin', 'confirmed'],
    [9002, students[2][0], 'confirmed', isoHoursAgo(45), 'admin', 'confirmed'],
    [9002, students[4][0], 'waitlisted', isoHoursAgo(44), null, 'waitlisted'],
    [9003, students[2][0], 'pending', isoHoursAgo(12), null, 'pending'],
    [9003, students[3][0], 'rejected', isoHoursAgo(36), 'admin', 'review_rejected'],
    [9004, students[4][0], 'confirmed', isoHoursAgo(24), 'admin', 'review_approved'],
    [9006, students[1][0], 'confirmed', isoHoursAgo(38), 'admin', 'confirmed'],
    [9006, students[2][0], 'confirmed', isoHoursAgo(37), 'admin', 'confirmed'],
    [9006, students[4][0], 'waitlisted', isoHoursAgo(18), null, 'waitlisted'],
  ]
  const statusUpdatedAt: Record<string, string> = {
    confirmed: isoHoursAgo(2),
    waitlisted: isoHoursAgo(6),
    pending: isoHoursAgo(12),
    rejected: isoHoursAgo(9),
  }
  for (const [activityId, account, status, registeredAt, reviewedBy, token] of registrations) {
    db.run(
      `INSERT INTO activity_registrations
         (activity_id, student_id, registered_at, status, reviewed_at, reviewed_by, status_updated_at, request_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [activityId, sid(account), registeredAt, status, status === 'pending' ? null : registeredAt,
        reviewedBy, statusUpdatedAt[status], token]
    )
  }
  db.run("UPDATE activities SET enrolled = (SELECT COUNT(*) FROM activity_registrations r WHERE r.activity_id = activities.id AND r.status = 'confirmed')")

  const notifications = [
    [students[0][0], 'waitlist_promoted', '候补递补成功',
      '你在「Python 数据分析工作坊」的候补已按顺序转为正式报名，请及时确认并按时参加；如无法参加请尽快取消，把名额让给后面的同学。',
      9003, 0, isoHoursAgo(2)],
    [students[0][0], 'review_approved', '报名审核已通过',
      '你在「校园摄影作品展」的报名申请已通过审核，已转为正式报名。',
      9004, 0, isoHoursAgo(5)],
    [students[0][0], 'review_rejected', '报名审核未通过',
      '很抱歉，你在「心理健康科普讲座」的报名申请未通过审核。如情况有变化，你可以在报名截止前重新提交申请。',
      9005, 1, isoHoursAgo(9)],
    [students[1][0], 'registration_resolved', '报名已自动转入候补',
      '「校园摄影作品展」已关闭报名审核，由于名额已满，你的申请已按顺序转入候补队列。',
      9004, 1, isoHoursAgo(11)],
  ]
  for (const notification of notifications) {
    db.run(
      'INSERT INTO notifications (account, type, title, body, activity_id, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      notification
    )
  }

  fs.writeFileSync(DB_FILE, encryptDatabase(db.export(), key))
  console.log('[seed] 演示数据已写入：8 个活动、5 名学生、15 条报名、4 条通知')
}

const step = process.argv[2]
if (step === 'init') await init()
else if (step === 'inject') await inject()
else console.log('用法: node seed-demo.mjs init|inject')
