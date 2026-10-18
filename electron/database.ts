import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Database as SqlDatabase } from 'sql.js'
import { createRequire } from 'node:module'
import nodemailer from 'nodemailer'
import type { Activity, ActivityOverview, ApplyResult, NotificationItem, NotificationType, RegistrationStatus, StudentRegistration } from '../src/types'
import { getPlatform } from './platform'

type Role = 'student' | 'teacher' | 'admin'

/** 当前操作者，由通道层根据登录令牌解析后传入，业务层据此做权限判断 */
export type Actor = { account: string; name: string; role: Role }

export type AuthInput = {
  account: string
  password: string
  name: string
  role: Role
  rememberMe: boolean
  email?: string
  verificationCode?: string
}

export type PublicUser = {
  id: string
  name: string
  role: Role
  avatar: string
}

const DB_FILE = 'campus-events.db.enc'
const KEY_FILE = 'campus-events.key'
const ADMIN_ACCOUNT = 'admin'
const ADMIN_SALT = 'campus-events-admin-v1'
const ADMIN_HASH = '030d022ae91f89b3bb563cf2fa23d0b4cb44d1b7d1ed023f1b0835c65c944cde4a9cb87a8aa604bece9b8cfb9da91c08ae04914d2be683b3f4431c9c21328288'
// 内置管理员账号，只负责账号启停与违规活动治理，不参与活动发布和审核
const ROOT_ACCOUNT = 'root'
const ROOT_SALT = 'campus-events-root-v1'
const ROOT_HASH = '4efc7e77a0bbafeb6435886f9a022adfd1dfe60b11df41bc0b193fa22587081224b517ad6a65b33a3165380e2c081cc2c8061e3935f625665194fd85b4fc622c'
let databasePromise: Promise<SqlDatabase> | undefined
const resetCodes = new Map<string, { hash: string; expiresAt: number; attempts: number }>()
const registrationCodes = new Map<string, { email: string; hash: string; expiresAt: number; attempts: number }>()

/** 生成相对“今天”的演示时间，避免内置活动随着时间推移全部过期、无法演示报名 */
function demoSchedule(daysFromNow: number, clock: string): string {
  const date = new Date()
  date.setDate(date.getDate() + daysFromNow)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`
}

const seedActivities = (): Array<Omit<Activity, 'id' | 'enrolled' | 'reviewEnabled' | 'status' | 'suspendedReason'>> => [
  { title: '校园科技创新节', category: 'academic', desc: '汇聚全校优秀科技项目，展示学生创新成果，更有企业嘉宾现场点评与实习机会。活动包含项目路演、技术工作坊、企业招聘宣讲三大板块。', time: demoSchedule(18, '09:00'), location: '大学生活动中心一楼展厅', capacity: 300, deadline: demoSchedule(17, '18:00'), organizer: '校团委科技创新部', icon: '🚀', teacherId: 'admin' },
  { title: '名企校友分享会：从校园到职场', category: 'academic', desc: '邀请三位毕业五年内的校友回校分享职业选择、面试技巧与成长心得。', time: demoSchedule(12, '19:00'), location: '图书馆报告厅', capacity: 120, deadline: demoSchedule(11, '23:59'), organizer: '学生职业发展协会', icon: '🎤', teacherId: 'admin' },
  { title: '秋季校园马拉松', category: 'sports', desc: '5 公里趣味跑，设置个人挑战组与团队接力组，完赛即可获得纪念奖牌。', time: demoSchedule(21, '07:30'), location: '东校区田径场', capacity: 500, deadline: demoSchedule(19, '22:00'), organizer: '体育教研部', icon: '🏃', teacherId: 'admin' },
  { title: '中秋月光市集', category: 'culture', desc: '传统手作、国风表演、灯谜游戏与特色美食，共度团圆佳节。', time: demoSchedule(16, '17:00'), location: '中心广场', capacity: 200, deadline: demoSchedule(15, '12:00'), organizer: '传统文化社', icon: '🏮', teacherId: 'admin' },
  { title: '社区英语辅导志愿服务', category: 'volunteer', desc: '面向周边社区小学生开展英语口语与作业辅导，需具备基础沟通能力。', time: demoSchedule(9, '14:00'), location: '阳光社区服务中心', capacity: 30, deadline: demoSchedule(8, '20:00'), organizer: '青年志愿者协会', icon: '🤝', teacherId: 'admin' },
  { title: '摄影社：城市光影外拍', category: 'club', desc: '周末外拍活动，由专业摄影教师带队，适合所有摄影爱好者。', time: demoSchedule(14, '08:00'), location: '老校区西门集合', capacity: 25, deadline: demoSchedule(12, '18:00'), organizer: '摄影协会', icon: '📷', teacherId: 'admin' },
  { title: '人工智能前沿讲座：大模型应用实践', category: 'academic', desc: '计算机学院副教授带你了解大模型在校园学习与科研中的实际应用。', time: demoSchedule(10, '15:30'), location: '工科楼 A301', capacity: 80, deadline: demoSchedule(9, '23:59'), organizer: '计算机学院', icon: '🤖', teacherId: 'admin' },
  { title: '草地音乐节', category: 'culture', desc: '乐队演出、独立音乐人、自由舞台，欢迎大家自带野餐垫参与。', time: demoSchedule(25, '18:00'), location: '西校区大草坪', capacity: 400, deadline: demoSchedule(24, '12:00'), organizer: '音乐社', icon: '🎸', teacherId: 'admin' },
  { title: '新生篮球友谊赛', category: 'sports', desc: '各学院新生篮球队友谊赛，欢迎到场加油助威。', time: demoSchedule(7, '16:00'), location: '体育馆主馆', capacity: 150, deadline: demoSchedule(6, '12:00'), organizer: '体育部', icon: '🏀', teacherId: 'admin' },
]

async function getDatabase() {
  try {
    return await (databasePromise ??= openDatabase())
  } catch (error) {
    console.error('[database] initialization failed:', error)
    databasePromise = undefined
    throw error
  }
}

function getPaths() {
  const userData = getPlatform().dataDir
  return {
    database: path.join(userData, DB_FILE),
    key: path.join(userData, KEY_FILE),
  }
}

function backupUnavailableStore(keyPath: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const databasePath = path.join(path.dirname(keyPath), DB_FILE)
  for (const filePath of [keyPath, databasePath]) {
    if (!fs.existsSync(filePath)) continue
    const backupPath = `${filePath}.backup-${stamp}`
    fs.renameSync(filePath, backupPath)
    console.warn(`[database] encrypted store was backed up to ${backupPath}`)
  }
}

function getEncryptionKey(keyPath: string) {
  const { keyProtector } = getPlatform()
  if (fs.existsSync(keyPath)) {
    const stored = fs.readFileSync(keyPath, 'utf8')
    if (stored.startsWith('safe:') && !keyProtector.available) {
      throw new Error('系统加密服务暂不可用，无法读取本地账号数据库')
    }
    if (stored.startsWith('safe:')) {
      try {
        return keyProtector.decrypt(stored.slice(5))
      } catch (error) {
        console.error('[database] stored encryption key cannot be decrypted; creating a fresh local store', error)
        backupUnavailableStore(keyPath)
      }
    }
    if (!stored.startsWith('safe:')) return stored
  }

  const key = crypto.randomBytes(32).toString('base64')
  if (keyProtector.available) {
    fs.writeFileSync(keyPath, `safe:${keyProtector.encrypt(key)}`, { mode: 0o600 })
  } else {
    fs.writeFileSync(keyPath, key, { mode: 0o600 })
  }
  return key
}

function encryptDatabase(data: Uint8Array, key: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)
  const encrypted = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()])
  return Buffer.concat([Buffer.from('CEV1'), iv, cipher.getAuthTag(), encrypted])
}

function decryptDatabase(data: Buffer, key: string) {
  if (data.subarray(0, 4).toString() !== 'CEV1') throw new Error('Invalid database format')
  const iv = data.subarray(4, 16)
  const tag = data.subarray(16, 32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data.subarray(32)), decipher.final()])
}

async function openDatabase() {
  const { database: databasePath, key: keyPath } = getPaths()
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const key = getEncryptionKey(keyPath)
  const require = createRequire(import.meta.url)
  const initSqlJs = require('sql.js') as typeof import('sql.js')
  const SQL = await initSqlJs({ locateFile: () => path.join(getPlatform().wasmDir, 'sql-wasm.wasm') })
  let db: SqlDatabase
  if (fs.existsSync(databasePath)) {
    db = new SQL.Database(new Uint8Array(decryptDatabase(fs.readFileSync(databasePath), key)))
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL CHECK(role IN ('student', 'teacher')),
      remember_me INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      activity_time TEXT NOT NULL,
      location TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      enrolled INTEGER NOT NULL DEFAULT 0,
      deadline TEXT NOT NULL,
      organizer TEXT NOT NULL,
      icon TEXT NOT NULL,
      teacher_id TEXT NOT NULL,
      review_enabled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      suspended_reason TEXT
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      registered_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      reviewed_at TEXT,
      reviewed_by TEXT,
      status_updated_at TEXT,
      request_token TEXT,
      UNIQUE(activity_id, student_id),
      FOREIGN KEY(activity_id) REFERENCES activities(id),
      FOREIGN KEY(student_id) REFERENCES users(id)
    )
  `)
  // V3.0：报名状态变化（候补递补、审核结果、活动下架）以站内通知的形式告知学生，
  // 解决“状态变了但学生不知道”导致候补流失的问题
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      activity_id INTEGER,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `)
  const existingActivityCount = Number(db.exec('SELECT COUNT(*) FROM activities')[0]?.values[0]?.[0] ?? 0)
  if (existingActivityCount === 0) {
    seedActivities().forEach((activity, id) => {
      db.run(
        `INSERT OR IGNORE INTO activities (id, title, category, description, activity_time, location, capacity, enrolled, deadline, organizer, icon, teacher_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [id, activity.title, activity.category, activity.desc, activity.time, activity.location, activity.capacity, activity.deadline, activity.organizer, activity.icon, activity.teacherId]
      )
    })
  }
  // 老版本数据库补齐新增列
  addColumn(db, 'users', 'email', 'TEXT')
  addColumn(db, 'users', 'status', "TEXT NOT NULL DEFAULT 'active'")
  addColumn(db, 'activities', 'review_enabled', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'activities', 'status', "TEXT NOT NULL DEFAULT 'active'")
  addColumn(db, 'activities', 'suspended_reason', 'TEXT')
  addColumn(db, 'activity_registrations', 'status', "TEXT NOT NULL DEFAULT 'confirmed'")
  addColumn(db, 'activity_registrations', 'reviewed_at', 'TEXT')
  addColumn(db, 'activity_registrations', 'reviewed_by', 'TEXT')
  // V3.0：状态变化时间用于“我的活动/详情”展示；请求令牌用于重复提交的幂等去重
  addColumn(db, 'activity_registrations', 'status_updated_at', 'TEXT')
  addColumn(db, 'activity_registrations', 'request_token', 'TEXT')
  db.run('UPDATE activity_registrations SET status_updated_at = COALESCE(status_updated_at, reviewed_at, registered_at)')
  db.run("UPDATE activities SET enrolled = (SELECT COUNT(*) FROM activity_registrations WHERE activity_id = activities.id AND status = 'confirmed')")
  // Remove legacy student accounts created before QQ email binding was required.
  db.run("DELETE FROM users WHERE role = 'student' AND (email IS NULL OR TRIM(email) = '')")
  await persistDatabase(db, databasePath, key)
  return db
}

function addColumn(db: SqlDatabase, table: string, column: string, definition: string) {
  try {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  } catch {
    // 列已存在
  }
}

function activityFromRow(row: unknown[]): Activity {
  const [id, title, category, desc, time, location, capacity, enrolled, deadline, organizer, icon, teacherId, reviewEnabled, status, suspendedReason, waitlistCount] = row
  return {
    id: Number(id),
    title: String(title),
    category: String(category) as Activity['category'],
    desc: String(desc),
    time: String(time),
    location: String(location),
    capacity: Number(capacity),
    enrolled: Number(enrolled),
    deadline: String(deadline),
    organizer: String(organizer),
    icon: String(icon),
    teacherId: teacherId === null || teacherId === undefined ? null : String(teacherId),
    reviewEnabled: Number(reviewEnabled) === 1,
    status: String(status) === 'suspended' ? 'suspended' : 'active',
    suspendedReason: suspendedReason === null || suspendedReason === undefined ? null : String(suspendedReason),
    waitlistCount: Number(waitlistCount ?? 0),
  }
}

const ACTIVITY_COLUMNS = 'id, title, category, description, activity_time, location, capacity, enrolled, deadline, organizer, icon, teacher_id, review_enabled, status, suspended_reason'
const ACTIVITY_SELECT = `${ACTIVITY_COLUMNS},
  (SELECT COUNT(*) FROM activity_registrations wr WHERE wr.activity_id = activities.id AND wr.status = 'waitlisted') AS waitlist_count`

/**
 * 活动广场列表。
 * 正常活动所有人可见；被下架的活动只对活动组织教师本人、管理员，以及已报名的学生可见。
 */
export async function listActivities(actor?: Actor | null): Promise<Activity[]> {
  const db = await getDatabase()
  const account = actor?.account ?? null
  const role = actor?.role ?? null
  const result = db.exec(
    `SELECT ${ACTIVITY_SELECT} FROM activities
     WHERE status = 'active'
        OR (? IS NOT NULL AND teacher_id = ?)
        OR ? = 'admin'
        OR (? IS NOT NULL AND EXISTS (
             SELECT 1 FROM activity_registrations r JOIN users u ON u.id = r.student_id
             WHERE r.activity_id = activities.id AND u.account = ?
           ))
     ORDER BY id`,
    [account, account, role, account, account]
  )
  return (result[0]?.values ?? []).map(activityFromRow)
}

export async function createActivity(input: Omit<Activity, 'id' | 'enrolled' | 'status' | 'suspendedReason'>, teacherAccount: string): Promise<Activity> {
  const db = await getDatabase()
  if (!input.title?.trim()) throw new Error('请填写活动名称')
  if (!Number.isFinite(input.capacity) || input.capacity < 1) throw new Error('人数上限至少为 1')
  // 时间戳 + 两位随机数，避免同一毫秒连续发布两个活动时主键冲突
  const id = Date.now() * 100 + Math.floor(Math.random() * 100)
  db.run(
    `INSERT INTO activities (id, title, category, description, activity_time, location, capacity, enrolled, deadline, organizer, icon, teacher_id, review_enabled, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'active')`,
    [id, input.title, input.category, input.desc, input.time, input.location, Number(input.capacity), input.deadline, input.organizer, input.icon, teacherAccount, input.reviewEnabled ? 1 : 0]
  )
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  return { ...input, id, teacherId: teacherAccount, enrolled: 0, status: 'active', suspendedReason: null, waitlistCount: 0 }
}

export async function updateActivity(id: number, input: Omit<Activity, 'id' | 'enrolled' | 'status' | 'suspendedReason'>, teacherAccount: string): Promise<Activity> {
  const db = await getDatabase()
  const result = db.exec('SELECT teacher_id, review_enabled FROM activities WHERE id = ?', [id])
  const row = result[0]?.values[0]
  if (!row) throw new Error('活动不存在')
  if (String(row[0]) !== teacherAccount) throw new Error('只能管理自己发布的活动')
  if (!Number.isFinite(input.capacity) || input.capacity < 1) throw new Error('人数上限至少为 1')
  const enrolled = confirmedCount(db, id)
  if (input.capacity < enrolled) throw new Error(`人数上限不能少于当前正式报名人数 ${enrolled}`)
  const reviewWasEnabled = Number(row[1]) === 1
  db.run(
    `UPDATE activities SET title = ?, category = ?, description = ?, activity_time = ?, location = ?, capacity = ?, deadline = ?, organizer = ?, icon = ?, review_enabled = ? WHERE id = ?`,
    [input.title, input.category, input.desc, input.time, input.location, Number(input.capacity), input.deadline, input.organizer, input.icon, input.reviewEnabled ? 1 : 0, id]
  )
  // 关闭审核时，之前待审核的申请按申请先后顺序自动处理；名额变大时同样按候补顺序递补
  if (reviewWasEnabled && !input.reviewEnabled) resolvePendingApplications(db, id)
  else promoteWaitlist(db, id)
  refreshEnrolled(db, id)
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  const status = db.exec('SELECT status, suspended_reason FROM activities WHERE id = ?', [id])[0]?.values[0]
  return {
    ...input,
    id,
    teacherId: teacherAccount,
    enrolled: confirmedCount(db, id),
    status: String(status?.[0]) === 'suspended' ? 'suspended' : 'active',
    suspendedReason: status?.[1] === null || status?.[1] === undefined ? null : String(status[1]),
    waitlistCount: Number(db.exec("SELECT COUNT(*) FROM activity_registrations WHERE activity_id = ? AND status = 'waitlisted'", [id])[0]?.values[0]?.[0] ?? 0),
  }
}

export async function removeActivity(id: number, teacherAccount: string) {
  const db = await getDatabase()
  const owner = db.exec('SELECT teacher_id FROM activities WHERE id = ?', [id])[0]?.values[0]
  if (!owner) throw new Error('活动不存在')
  if (String(owner[0]) !== teacherAccount) throw new Error('只能管理自己发布的活动')
  db.run('DELETE FROM activity_registrations WHERE activity_id = ?', [id])
  db.run('DELETE FROM activities WHERE id = ?', [id])
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
}

function normalizeStatus(value: unknown): RegistrationStatus {
  const status = String(value)
  return status === 'waitlisted' || status === 'pending' || status === 'rejected' ? status : 'confirmed'
}

function findStudent(db: SqlDatabase, account: string) {
  const row = db.exec("SELECT id, name, COALESCE(status, 'active') FROM users WHERE account = ? AND role = 'student'", [account.trim()])[0]?.values[0]
  if (!row) throw new Error('学生账号不存在')
  return { id: Number(row[0]), name: String(row[1]), status: String(row[2]) }
}

function confirmedCount(db: SqlDatabase, activityId: number) {
  return Number(db.exec("SELECT COUNT(*) FROM activity_registrations WHERE activity_id = ? AND status = 'confirmed'", [activityId])[0]?.values[0]?.[0] ?? 0)
}

function capacityOf(db: SqlDatabase, activityId: number) {
  return Number(db.exec('SELECT capacity FROM activities WHERE id = ?', [activityId])[0]?.values[0]?.[0] ?? 0)
}

/** 活动的 enrolled 始终等于“正式报名”人数，避免计数漂移 */
function refreshEnrolled(db: SqlDatabase, activityId: number) {
  db.run("UPDATE activities SET enrolled = (SELECT COUNT(*) FROM activity_registrations WHERE activity_id = ? AND status = 'confirmed') WHERE id = ?", [activityId, activityId])
}

/** V3.0：写入一条站内通知，学生端据此感知报名状态变化 */
function notify(db: SqlDatabase, account: string, type: NotificationType, title: string, body: string, activityId: number | null) {
  const target = account.trim()
  if (!target) return
  db.run(
    'INSERT INTO notifications (account, type, title, body, activity_id, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    [target, type, title, body, activityId, new Date().toISOString()]
  )
}

function activityTitle(db: SqlDatabase, activityId: number) {
  return String(db.exec('SELECT title FROM activities WHERE id = ?', [activityId])[0]?.values[0]?.[0] ?? '该活动')
}

function waitlistQueue(db: SqlDatabase, activityId: number) {
  return db.exec(
    `SELECT u.id, u.account, u.name FROM activity_registrations r JOIN users u ON u.id = r.student_id
     WHERE r.activity_id = ? AND r.status = 'waitlisted' ORDER BY r.registered_at, r.id`,
    [activityId]
  )[0]?.values ?? []
}

function waitlistPosition(db: SqlDatabase, activityId: number, studentId: number) {
  const index = waitlistQueue(db, activityId).findIndex(row => Number(row[0]) === studentId)
  return index === -1 ? null : index + 1
}

/** 名额释放后，按“先申请先递补”的顺序把候补转为正式，直到名额用满 */
function promoteWaitlist(db: SqlDatabase, activityId: number) {
  const promoted: Array<{ account: string; name: string }> = []
  const capacity = capacityOf(db, activityId)
  let confirmed = confirmedCount(db, activityId)
  const now = new Date().toISOString()
  for (const row of waitlistQueue(db, activityId)) {
    if (confirmed >= capacity) break
    db.run(
      `UPDATE activity_registrations SET status = 'confirmed', reviewed_at = ?, reviewed_by = 'system', status_updated_at = ?
       WHERE activity_id = ? AND student_id = ?`,
      [now, now, activityId, Number(row[0])]
    )
    confirmed += 1
    promoted.push({ account: String(row[1]), name: String(row[2]) })
    notify(db, String(row[1]), 'waitlist_promoted', '候补递补成功',
      `你在「${activityTitle(db, activityId)}」的候补已按顺序转为正式报名，请及时确认并按时参加；如无法参加请尽快取消，把名额让给后面的同学。`,
      activityId)
  }
  return promoted
}

/** 教师关闭报名审核后，之前待审核的申请按申请先后顺序自动转为正式或候补 */
function resolvePendingApplications(db: SqlDatabase, activityId: number) {
  const pending = db.exec(
    `SELECT r.student_id, u.account FROM activity_registrations r JOIN users u ON u.id = r.student_id
     WHERE r.activity_id = ? AND r.status = 'pending' ORDER BY r.registered_at, r.id`,
    [activityId]
  )[0]?.values ?? []
  const capacity = capacityOf(db, activityId)
  let confirmed = confirmedCount(db, activityId)
  const now = new Date().toISOString()
  for (const row of pending) {
    const status = confirmed < capacity ? 'confirmed' : 'waitlisted'
    if (status === 'confirmed') confirmed += 1
    db.run("UPDATE activity_registrations SET status = ?, reviewed_at = ?, reviewed_by = 'system', status_updated_at = ? WHERE activity_id = ? AND student_id = ?", [status, now, now, activityId, Number(row[0])])
    notify(db, String(row[1]), 'registration_resolved',
      status === 'confirmed' ? '报名已自动转为正式' : '报名已自动转入候补',
      status === 'confirmed'
        ? `「${activityTitle(db, activityId)}」已关闭报名审核，你的申请按顺序自动转为正式报名。`
        : `「${activityTitle(db, activityId)}」已关闭报名审核，由于名额已满，你的申请已按顺序转入候补队列。`,
      activityId)
  }
}

function registrationState(db: SqlDatabase, activityId: number, studentId: number): StudentRegistration {
  const row = db.exec(
    'SELECT status, registered_at, reviewed_at, status_updated_at, request_token FROM activity_registrations WHERE activity_id = ? AND student_id = ?',
    [activityId, studentId]
  )[0]?.values[0]
  if (!row) throw new Error('报名记录不存在')
  const status = normalizeStatus(row[0])
  return {
    activityId,
    status,
    position: status === 'waitlisted' ? waitlistPosition(db, activityId, studentId) : null,
    registeredAt: String(row[1]),
    reviewedAt: row[2] === null || row[2] === undefined ? null : String(row[2]),
    statusUpdatedAt: String(row[3] ?? row[2] ?? row[1]),
    requestId: row[4] === null || row[4] === undefined ? null : String(row[4]),
  }
}

/** 学生自己的全部报名记录，含状态、候补序号与最近一次状态变化时间 */
export async function listStudentRegistrations(account: string): Promise<StudentRegistration[]> {
  const db = await getDatabase()
  const student = findStudent(db, account)
  const rows = db.exec(
    'SELECT activity_id, status, registered_at, reviewed_at, status_updated_at, request_token FROM activity_registrations WHERE student_id = ?',
    [student.id]
  )[0]?.values ?? []
  return rows.map(row => {
    const status = normalizeStatus(row[1])
    return {
      activityId: Number(row[0]),
      status,
      position: status === 'waitlisted' ? waitlistPosition(db, Number(row[0]), student.id) : null,
      registeredAt: String(row[2]),
      reviewedAt: row[3] === null || row[3] === undefined ? null : String(row[3]),
      statusUpdatedAt: String(row[4] ?? row[3] ?? row[2]),
      requestId: row[5] === null || row[5] === undefined ? null : String(row[5]),
    }
  })
}

/**
 * 报名：
 * - 活动开启审核 → 进入待审核，由组织教师决定通过（按剩余名额转正式或候补）或未通过；
 * - 活动未开启审核 → 有名额直接正式，满员则进入候补队列。
 *
 * V3.0：服务端按 requestToken 幂等。重复点击、网络重试或页面刷新后再次提交，
 * 只要该学生对此活动已有正式/候补/待审核记录，就返回当前状态（reused=true），
 * 不再报“你已经报名”这种让人不确定的错误，也不会重复占用名额。
 */
export async function applyForActivity(account: string, activityId: number, requestToken?: string | null): Promise<ApplyResult> {
  const db = await getDatabase()
  const student = findStudent(db, account)
  if (student.status === 'disabled') throw new Error('账号已停用，请联系管理员')
  const activity = db.exec('SELECT capacity, review_enabled, status FROM activities WHERE id = ?', [activityId])[0]?.values[0]
  if (!activity) throw new Error('活动不存在')
  if (String(activity[2]) === 'suspended') throw new Error('该活动已被管理员下架，暂不能报名')

  const token = (requestToken ?? '').trim() || crypto.randomUUID()
  const existing = db.exec(
    'SELECT status, request_token FROM activity_registrations WHERE activity_id = ? AND student_id = ?',
    [activityId, student.id]
  )[0]?.values[0]
  if (existing) {
    const current = normalizeStatus(existing[0])
    if (current !== 'rejected') {
      return { ...registrationState(db, activityId, student.id), reused: true }
    }
  }

  const reviewEnabled = Number(activity[1]) === 1
  const status: RegistrationStatus = reviewEnabled
    ? 'pending'
    : confirmedCount(db, activityId) < Number(activity[0]) ? 'confirmed' : 'waitlisted'
  const now = new Date().toISOString()

  if (existing) {
    // 未通过的记录允许重新申请，重新提交后回到待审核/排队流程
    db.run(
      `UPDATE activity_registrations
       SET status = ?, registered_at = ?, reviewed_at = NULL, reviewed_by = NULL,
           status_updated_at = ?, request_token = ?
       WHERE activity_id = ? AND student_id = ?`,
      [status, now, now, token, activityId, student.id]
    )
  } else {
    db.run(
      `INSERT INTO activity_registrations (activity_id, student_id, registered_at, status, status_updated_at, request_token)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [activityId, student.id, now, status, now, token]
    )
  }
  refreshEnrolled(db, activityId)
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  return { ...registrationState(db, activityId, student.id), reused: false }
}

/** 取消报名 / 退出候补 / 撤回待审核申请；正式名额取消后自动递补给排队最靠前的候补 */
export async function cancelRegistration(account: string, activityId: number) {
  const db = await getDatabase()
  const student = findStudent(db, account)
  const existing = db.exec('SELECT status FROM activity_registrations WHERE activity_id = ? AND student_id = ?', [activityId, student.id])[0]?.values[0]
  if (!existing) throw new Error('你还没有报名该活动')
  const previous = normalizeStatus(existing[0])
  db.run('DELETE FROM activity_registrations WHERE activity_id = ? AND student_id = ?', [activityId, student.id])
  const promoted = previous === 'confirmed' ? promoteWaitlist(db, activityId) : []
  refreshEnrolled(db, activityId)
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  return { previous, promoted }
}

/** 活动组织教师查看报名名单：正式、候补（带顺序）、待审核、未通过分组排序 */
export async function listActivityRegistrants(activityId: number, teacherAccount: string) {
  const db = await getDatabase()
  const owner = db.exec('SELECT teacher_id FROM activities WHERE id = ?', [activityId])[0]?.values[0]
  if (!owner) throw new Error('活动不存在')
  if (String(owner[0]) !== teacherAccount) throw new Error('只能查看自己发布活动的报名名单')
  const rows = db.exec(
    `SELECT u.id, u.account, u.name, COALESCE(u.email, ''), r.registered_at, r.status
     FROM activity_registrations r JOIN users u ON u.id = r.student_id
     WHERE r.activity_id = ?`,
    [activityId]
  )[0]?.values ?? []
  const rank: Record<string, number> = { confirmed: 0, waitlisted: 1, pending: 2, rejected: 3 }
  return rows
    .map(row => {
      const status = normalizeStatus(row[5])
      return {
        id: Number(row[0]),
        account: String(row[1]),
        name: String(row[2]),
        email: String(row[3]),
        registeredAt: String(row[4]),
        status,
        position: status === 'waitlisted' ? waitlistPosition(db, activityId, Number(row[0])) : null,
      }
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.position ?? 0) - (b.position ?? 0) || a.registeredAt.localeCompare(b.registeredAt))
}

/** 组织教师审核本人负责活动的报名申请 */
export async function reviewRegistration(teacherAccount: string, activityId: number, studentAccount: string, decision: 'approve' | 'reject') {
  const db = await getDatabase()
  const activity = db.exec('SELECT teacher_id, capacity, review_enabled FROM activities WHERE id = ?', [activityId])[0]?.values[0]
  if (!activity) throw new Error('活动不存在')
  if (String(activity[0]) !== teacherAccount) throw new Error('只能审核自己发布的活动')
  if (Number(activity[2]) !== 1) throw new Error('该活动未开启报名审核')

  const student = db.exec("SELECT id, name, account FROM users WHERE account = ? AND role = 'student'", [studentAccount.trim()])[0]?.values[0]
  if (!student) throw new Error('学生账号不存在')
  const current = db.exec('SELECT status FROM activity_registrations WHERE activity_id = ? AND student_id = ?', [activityId, Number(student[0])])[0]?.values[0]
  if (!current) throw new Error('该学生没有提交报名申请')
  if (normalizeStatus(current[0]) !== 'pending') throw new Error('该申请不处于待审核状态')

  const status: RegistrationStatus = decision === 'approve'
    ? confirmedCount(db, activityId) < Number(activity[1]) ? 'confirmed' : 'waitlisted'
    : 'rejected'
  db.run(
    'UPDATE activity_registrations SET status = ?, reviewed_at = ?, reviewed_by = ?, status_updated_at = ? WHERE activity_id = ? AND student_id = ?',
    [status, new Date().toISOString(), teacherAccount, new Date().toISOString(), activityId, Number(student[0])]
  )
  refreshEnrolled(db, activityId)
  if (decision === 'approve') {
    notify(db, String(student[2]), 'review_approved', '报名审核已通过',
      status === 'confirmed'
        ? `你在「${activityTitle(db, activityId)}」的报名申请已通过审核，已转为正式报名。`
        : `你在「${activityTitle(db, activityId)}」的报名申请已通过审核，但名额已满，已按顺序转入候补队列。`,
      activityId)
  } else {
    notify(db, String(student[2]), 'review_rejected', '报名审核未通过',
      `很抱歉，你在「${activityTitle(db, activityId)}」的报名申请未通过审核。如情况有变化，你可以在报名截止前重新提交申请。`,
      activityId)
  }
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  return { account: String(student[2]), name: String(student[1]), status, position: status === 'waitlisted' ? waitlistPosition(db, activityId, Number(student[0])) : null }
}

async function persistDatabase(db: SqlDatabase, databasePath: string, key: string) {
  const temporaryPath = `${databasePath}.tmp`
  fs.writeFileSync(temporaryPath, encryptDatabase(db.export(), key), { mode: 0o600 })
  fs.renameSync(temporaryPath, databasePath)
}

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

function publicUser(account: string, name: string, role: Role): PublicUser {
  return { id: account, name, role, avatar: name.charAt(0).toUpperCase() }
}

export async function registerUser(input: AuthInput): Promise<PublicUser> {
  const db = await getDatabase()
  const account = input.account.trim()
  const name = input.name.trim()
  if (input.role !== 'student') throw new Error('教师端不支持注册')
  if (!/^\d{16}$/.test(account)) throw new Error('学号必须是 16 位数字')
  if (input.password.length < 6) throw new Error('密码至少需要 6 位')
  if (!input.email || !/^\S+@qq\.com$/i.test(input.email.trim())) throw new Error('请填写有效的 QQ 邮箱')
  if (!account || !input.password || !name) throw new Error('请填写完整的账号、密码和姓名')
  if (account.toLowerCase() === ADMIN_ACCOUNT) throw new Error('该账号为教师专用账号')
  const verification = registrationCodes.get(account)
  if (!verification || verification.expiresAt < Date.now()) { registrationCodes.delete(account); throw new Error('请先获取注册验证码') }
  if (verification.email !== input.email.trim().toLowerCase()) throw new Error('验证码与注册邮箱不匹配')
  if (++verification.attempts > 5) { registrationCodes.delete(account); throw new Error('验证码错误次数过多，请重新获取') }
  const actualCode = hashPassword(input.verificationCode?.trim() ?? '', 'register-code-salt')
  if (!crypto.timingSafeEqual(Buffer.from(actualCode), Buffer.from(verification.hash))) throw new Error('注册验证码错误')
  const salt = crypto.randomBytes(16).toString('hex')
  const now = new Date().toISOString()
  try {
    db.run(
      `INSERT INTO users (account, password_hash, password_salt, name, email, role, remember_me, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [account, hashPassword(input.password, salt), salt, name, input.email.trim().toLowerCase(), input.role, 0, now, now]
    )
  } catch {
    throw new Error('该账号已经注册过了')
  }
  registrationCodes.delete(account)
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  return publicUser(account, name, input.role)
}

export async function getRegisteredStudentCount() {
  const db = await getDatabase()
  const result = db.exec("SELECT COUNT(*) FROM users WHERE role = 'student' AND COALESCE(status, 'active') = 'active'")
  return Number(result[0]?.values[0]?.[0] ?? 0)
}

export async function listStudents() {
  const db = await getDatabase()
  const result = db.exec("SELECT id, account, name, COALESCE(email, ''), created_at, COALESCE(status, 'active') FROM users WHERE role = 'student' ORDER BY id DESC")
  return (result[0]?.values ?? []).map(([id, account, name, email, createdAt, status]) => ({
    id: Number(id), account: String(account), name: String(name), email: String(email), createdAt: String(createdAt), status: String(status) === 'disabled' ? 'disabled' : 'active'
  }))
}

/** 管理员：启用 / 停用学生账号 */
export async function setAccountStatus(account: string, status: 'active' | 'disabled') {
  if (status !== 'active' && status !== 'disabled') throw new Error('账号状态不合法')
  const db = await getDatabase()
  const row = db.exec("SELECT id FROM users WHERE account = ? AND role = 'student'", [account.trim()])[0]?.values[0]
  if (!row) throw new Error('该账号不存在')
  db.run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', [status, new Date().toISOString(), Number(row[0])])
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  return { account: account.trim(), status }
}

/** 管理员：下架违规活动 */
export async function suspendActivity(id: number, reason: string) {
  const reasonText = reason.trim()
  if (!reasonText) throw new Error('请填写下架原因')
  const db = await getDatabase()
  const row = db.exec('SELECT id FROM activities WHERE id = ?', [id])[0]?.values[0]
  if (!row) throw new Error('活动不存在')
  db.run("UPDATE activities SET status = 'suspended', suspended_reason = ? WHERE id = ?", [reasonText, id])
  // V3.0：活动被下架后，已报名的学生此前只能自己进详情页才发现，这里主动通知
  const title = activityTitle(db, id)
  const registered = db.exec(
    `SELECT u.account FROM activity_registrations r JOIN users u ON u.id = r.student_id
     WHERE r.activity_id = ? AND r.status IN ('confirmed', 'waitlisted', 'pending')`,
    [id]
  )[0]?.values ?? []
  for (const row of registered) {
    notify(db, String(row[0]), 'activity_suspended', '已报名活动被下架',
      `你报名的「${title}」已被管理员下架，原因：${reasonText}。该活动暂不能参加，如有疑问请联系活动主办方。`,
      id)
  }
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  return { id, status: 'suspended' as const, reason: reasonText }
}

/** 管理员：恢复已下架活动 */
export async function restoreActivity(id: number) {
  const db = await getDatabase()
  const row = db.exec('SELECT id FROM activities WHERE id = ?', [id])[0]?.values[0]
  if (!row) throw new Error('活动不存在')
  db.run("UPDATE activities SET status = 'active', suspended_reason = NULL WHERE id = ?", [id])
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  return { id, status: 'active' as const }
}

/** V3.0：学生自己的站内通知列表（未读优先，其次按时间倒序） */
export async function listNotifications(account: string): Promise<NotificationItem[]> {
  const db = await getDatabase()
  const rows = db.exec(
    'SELECT id, type, title, body, activity_id, read, created_at FROM notifications WHERE account = ? ORDER BY read ASC, id DESC',
    [account.trim()]
  )[0]?.values ?? []
  return rows.map(row => ({
    id: Number(row[0]),
    type: String(row[1]) as NotificationItem['type'],
    title: String(row[2]),
    body: String(row[3]),
    activityId: row[4] === null || row[4] === undefined ? null : Number(row[4]),
    read: Number(row[5]) === 1,
    createdAt: String(row[6]),
  }))
}

/** V3.0：标记通知已读（传 id 标记单条，不传则全部标记为已读） */
export async function markNotificationsRead(account: string, id?: number | null) {
  const db = await getDatabase()
  const target = account.trim()
  if (id === null || id === undefined) {
    db.run('UPDATE notifications SET read = 1 WHERE account = ?', [target])
  } else {
    db.run('UPDATE notifications SET read = 1 WHERE account = ? AND id = ?', [target, Number(id)])
  }
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  return { success: true }
}

/** V3.0：教师端活动报名结构概览，用于判断候补/待审核积压与供需失衡 */
export async function listActivityOverviews(teacherAccount: string): Promise<ActivityOverview[]> {
  const db = await getDatabase()
  const rows = db.exec(
    `SELECT a.id, a.capacity,
       (SELECT COUNT(*) FROM activity_registrations r WHERE r.activity_id = a.id) AS applied,
       (SELECT COUNT(*) FROM activity_registrations r WHERE r.activity_id = a.id AND r.status = 'confirmed') AS confirmed,
       (SELECT COUNT(*) FROM activity_registrations r WHERE r.activity_id = a.id AND r.status = 'waitlisted') AS waitlisted,
       (SELECT COUNT(*) FROM activity_registrations r WHERE r.activity_id = a.id AND r.status = 'pending') AS pending,
       (SELECT COUNT(*) FROM activity_registrations r WHERE r.activity_id = a.id AND r.status = 'rejected') AS rejected
     FROM activities a WHERE a.teacher_id = ? ORDER BY a.id`,
    [teacherAccount]
  )[0]?.values ?? []
  return rows.map(row => ({
    activityId: Number(row[0]),
    capacity: Number(row[1]),
    applied: Number(row[2]),
    confirmed: Number(row[3]),
    waitlisted: Number(row[4]),
    pending: Number(row[5]),
    rejected: Number(row[6]),
  }))
}

export async function updateStudent(id: number, input: { name: string; email: string }) {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (!name || !/^\S+@qq\.com$/i.test(email)) throw new Error('请填写有效的姓名和 QQ 邮箱')
  const db = await getDatabase()
  db.run("UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ? AND role = 'student'", [name, email, new Date().toISOString(), id])
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  return { id, name, email }
}

export async function resetStudentPasswordByAdmin(id: number, newPassword: string) {
  if (newPassword.length < 6) throw new Error('新密码至少需要 6 位')
  const db = await getDatabase()
  const salt = crypto.randomBytes(16).toString('hex')
  db.run("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ? AND role = 'student'", [hashPassword(newPassword, salt), salt, new Date().toISOString(), id])
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
}

export async function removeStudent(id: number) {
  const db = await getDatabase()
  db.run('DELETE FROM activity_registrations WHERE student_id = ?', [id])
  db.run("DELETE FROM users WHERE id = ? AND role = 'student'", [id])
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
}

function mailTransport() {
  const user = process.env.QQ_SMTP_USER?.trim()
  const pass = process.env.QQ_SMTP_AUTH_CODE?.trim()
  if (!user || !pass) throw new Error('尚未配置 QQ 邮箱服务，请联系管理员')
  return { user, transporter: nodemailer.createTransport({ host: 'smtp.qq.com', port: 465, secure: true, auth: { user, pass } }) }
}

export async function sendResetCode(account: string) {
  const db = await getDatabase()
  const result = db.exec("SELECT email FROM users WHERE account = ? AND role = 'student'", [account.trim()])
  const email = result[0]?.values[0]?.[0]
  if (!email) throw new Error('该用户不存在或未绑定 QQ 邮箱')
  const code = String(crypto.randomInt(100000, 1000000))
  const { user, transporter } = mailTransport()
  try {
    await transporter.sendMail({ from: user, to: String(email), subject: 'CampusEvents 密码重置验证码', text: `你的验证码是 ${code}，5 分钟内有效。` })
  } catch {
    throw new Error('验证码发送失败，请稍后重试')
  }
  resetCodes.set(account.trim(), { hash: hashPassword(code, 'reset-code-salt'), expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 })
  return { maskedEmail: String(email).replace(/^(.{2}).*(@.*)$/, '$1****$2') }
}

export async function resetStudentPassword(account: string, code: string, newPassword: string) {
  const key = account.trim()
  const entry = resetCodes.get(key)
  if (!entry || entry.expiresAt < Date.now()) { resetCodes.delete(key); throw new Error('验证码无效或已过期') }
  if (++entry.attempts > 5) { resetCodes.delete(key); throw new Error('验证码错误次数过多，请重新获取') }
  const actual = hashPassword(code, 'reset-code-salt')
  if (!crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(entry.hash))) throw new Error('验证码错误')
  if (newPassword.length < 6) throw new Error('新密码至少需要 6 位')
  const db = await getDatabase()
  const salt = crypto.randomBytes(16).toString('hex')
  db.run("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE account = ? AND role = 'student'", [hashPassword(newPassword, salt), salt, new Date().toISOString(), key])
  const { database: databasePath, key: keyPath } = getPaths()
  await persistDatabase(db, databasePath, getEncryptionKey(keyPath))
  resetCodes.delete(key)
}

export async function sendRegistrationCode(account: string, email: string) {
  const normalizedAccount = account.trim()
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedAccount) throw new Error('请输入注册账号')
  if (!/^\S+@qq\.com$/i.test(normalizedEmail)) throw new Error('请填写有效的 QQ 邮箱')
  const db = await getDatabase()
  if (db.exec('SELECT 1 FROM users WHERE account = ?', [normalizedAccount])[0]?.values[0]) throw new Error('该账号已经注册过了')
  const code = String(crypto.randomInt(100000, 1000000))
  const { user, transporter } = mailTransport()
  try {
    await transporter.sendMail({ from: user, to: normalizedEmail, subject: 'CampusEvents 注册验证码', text: `你的注册验证码是 ${code}，5 分钟内有效。` })
  } catch {
    throw new Error('验证码发送失败，请稍后重试')
  }
  registrationCodes.set(normalizedAccount, { email: normalizedEmail, hash: hashPassword(code, 'register-code-salt'), expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 })
  return { maskedEmail: normalizedEmail.replace(/^(.{2}).*(@.*)$/, '$1****$2') }
}

export async function loginUser(account: string, password: string, loginRole: Role): Promise<PublicUser> {
  const normalized = account.trim()
  if (loginRole !== 'student') {
    if (normalized === ADMIN_ACCOUNT && matchesPassword(password, ADMIN_SALT, ADMIN_HASH)) return publicUser(ADMIN_ACCOUNT, 'admin', 'teacher')
    if (normalized === ROOT_ACCOUNT && matchesPassword(password, ROOT_SALT, ROOT_HASH)) return publicUser(ROOT_ACCOUNT, '系统管理员', 'admin')
    throw new Error('账号或密码错误')
  }
  const db = await getDatabase()
  const result = db.exec("SELECT account, password_hash, password_salt, name, role, COALESCE(status, 'active') FROM users WHERE account = ?", [normalized])
  const row = result[0]?.values[0]
  if (!row) throw new Error('USER_NOT_FOUND')
  const [storedAccount, storedHash, salt, name, userRole, status] = row.map(String)
  const actual = hashPassword(password, salt)
  if (actual.length !== storedHash.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(storedHash))) {
    throw new Error('账号或密码错误')
  }
  if (status === 'disabled') throw new Error('ACCOUNT_DISABLED')
  return publicUser(storedAccount, name, userRole as Role)
}

function matchesPassword(password: string, salt: string, expected: string) {
  const actual = hashPassword(password, salt)
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}
