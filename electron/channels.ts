/**
 * 前端可调用的全部业务通道。
 *
 * Electron 主进程把这些通道注册成 ipcMain.handle，
 * 浏览器版本的本地 API 服务把它们映射成 POST /api/<通道名>，
 * 两个入口共用同一份参数校验、权限判断与错误提示。
 *
 * 权限边界：
 * - 学生：只能操作自己的报名（报名、取消、退出候补、查看自己的状态）
 * - 教师：只能发布、修改、删除、审核自己负责的活动
 * - 管理员：只做账号启停与违规活动治理，不参与活动发布与审核
 */
import {
  applyForActivity,
  cancelRegistration,
  createActivity,
  getRegisteredStudentCount,
  listActivities,
  listActivityOverviews,
  listActivityRegistrants,
  listNotifications,
  listStudentRegistrations,
  listStudents,
  loginUser,
  markNotificationsRead,
  registerUser,
  removeActivity,
  removeStudent,
  resetStudentPassword,
  resetStudentPasswordByAdmin,
  restoreActivity,
  reviewRegistration,
  sendRegistrationCode,
  sendResetCode,
  setAccountStatus,
  suspendActivity,
  updateActivity,
  updateStudent,
} from './database'
import type { Actor } from './database'
import { createSession, destroySession } from './session'
import type { Activity } from '../src/types'

export type ChannelContext = { actor: Actor | null; token: string | null }
// 通道参数来自渲染进程，这里统一按 unknown 接收后再逐个校验转换
/* eslint-disable @typescript-eslint/no-explicit-any */
export type ChannelHandler = (payload: any, context: ChannelContext) => unknown

function requireActor(context: ChannelContext): Actor {
  if (!context.actor) throw new Error('登录状态已失效，请重新登录')
  return context.actor
}

function requireStudent(context: ChannelContext): Actor {
  const actor = requireActor(context)
  if (actor.role !== 'student') throw new Error('只有学生可以操作自己的报名')
  return actor
}

function requireTeacher(context: ChannelContext): Actor {
  const actor = requireActor(context)
  if (actor.role !== 'teacher') throw new Error('只有活动组织教师可以执行该操作')
  return actor
}

function requireAdmin(context: ChannelContext): Actor {
  const actor = requireActor(context)
  if (actor.role !== 'admin') throw new Error('只有管理员可以执行该操作')
  return actor
}

/**
 * 公开通道（活动列表、公共统计）允许未登录访问，但如果请求带着一个已经失效的令牌，
 * 说明会话已经过期，必须明确报错让前端退回登录页，而不是静默按未登录视角返回数据。
 */
function assertSessionUsable(context: ChannelContext) {
  if (context.token && !context.actor) throw new Error('登录状态已失效，请重新登录')
}

export const channels: Record<string, ChannelHandler> = {
  // ---------- 账号 ----------
  'auth:register': (input) => registerUser(input),

  'auth:send-registration-code': (input: { account: string; email: string }) =>
    sendRegistrationCode(input?.account ?? '', input?.email ?? ''),

  'auth:login': async (input: { account: string; password: string; role: 'student' | 'teacher' | 'admin' }) => {
    try {
      const user = await loginUser(input.account, input.password, input.role)
      const token = createSession({ account: user.id, name: user.name, role: user.role })
      return { user, token }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'USER_NOT_FOUND') throw new Error('该用户不存在')
      if (message === 'ACCOUNT_DISABLED') throw new Error('账号已停用，请联系管理员')
      if (message.includes('账号') || message.includes('密码')) throw new Error('密码错误')
      throw new Error('数据库暂时不可用，请重启软件后重试')
    }
  },

  'auth:logout': (_payload, context) => {
    destroySession(context.token)
    return { success: true }
  },

  'auth:send-reset-code': async (input: { account: string }) => {
    try {
      return await sendResetCode(input?.account ?? '')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('不存在') || message.includes('未绑定')) throw new Error('该用户不存在或未绑定 QQ 邮箱')
      if (message.includes('QQ 邮箱服务')) throw new Error('尚未配置 QQ 邮箱服务，请联系管理员')
      throw new Error('验证码发送失败，请稍后重试')
    }
  },

  'auth:reset-password': async (input: { account: string; code: string; newPassword: string }) => {
    try {
      await resetStudentPassword(input?.account ?? '', input?.code ?? '', input?.newPassword ?? '')
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('验证码无效')) throw new Error('验证码无效或已过期')
      if (message.includes('验证码错误次数')) throw new Error('验证码错误次数过多，请重新获取')
      if (message.includes('验证码错误')) throw new Error('验证码错误')
      if (message.includes('至少需要')) throw new Error('新密码至少需要 6 位')
      throw new Error('密码修改失败，请稍后重试')
    }
  },

  // ---------- 活动（浏览对所有人生效，写操作限本人） ----------
  'activities:list': async (_payload, context) => {
    assertSessionUsable(context)
    return listActivities(context.actor)
  },

  'activities:create': async (input: Omit<Activity, 'id' | 'enrolled' | 'status' | 'suspendedReason'>, context) =>
    createActivity(input, requireTeacher(context).account),

  'activities:update': async (input: Activity, context) =>
    updateActivity(Number(input.id), input, requireTeacher(context).account),

  'activities:delete': async (id: number | string, context) =>
    removeActivity(Number(id), requireTeacher(context).account),

  'activities:registrants': async (id: number | string, context) =>
    listActivityRegistrants(Number(id), requireTeacher(context).account),

  'activities:review': async (
    input: { activityId: number | string; studentAccount: string; decision: 'approve' | 'reject' },
    context,
  ) => reviewRegistration(requireTeacher(context).account, Number(input.activityId), input.studentAccount, input.decision),

  // ---------- 报名（学生本人） ----------
  'activities:registrations': async (_payload, context) => listStudentRegistrations(requireStudent(context).account),

  'activities:apply': async (input: { activityId: number | string; requestId?: string | null }, context) =>
    applyForActivity(requireStudent(context).account, Number(input.activityId), input.requestId ?? null),

  'activities:cancel': async (input: { activityId: number | string }, context) =>
    cancelRegistration(requireStudent(context).account, Number(input.activityId)),

  // ---------- 站内通知（V3.0：报名状态变化可感知） ----------
  'notifications:list': async (_payload, context) => {
    const actor = requireActor(context)
    return listNotifications(actor.account)
  },

  'notifications:mark-read': async (input: { id?: number | string | null }, context) => {
    const actor = requireActor(context)
    const id = input?.id === undefined || input?.id === null ? null : Number(input.id)
    return markNotificationsRead(actor.account, id)
  },

  // ---------- 教师端报名结构概览（V3.0） ----------
  'activities:overview': async (_payload, context) => listActivityOverviews(requireTeacher(context).account),

  // ---------- 管理员：账号启停与违规活动治理 ----------
  'students:list': async (_payload, context) => {
    requireAdmin(context)
    return listStudents()
  },

  'students:update': async (input: { id: number | string; name: string; email: string }, context) => {
    requireAdmin(context)
    return updateStudent(Number(input.id), input)
  },

  'students:reset-password': async (input: { id: number | string; password: string }, context) => {
    requireAdmin(context)
    return resetStudentPasswordByAdmin(Number(input.id), input.password)
  },

  'students:delete': async (id: number | string, context) => {
    requireAdmin(context)
    return removeStudent(Number(id))
  },

  'admin:set-account-status': async (input: { account: string; status: 'active' | 'disabled' }, context) => {
    requireAdmin(context)
    return setAccountStatus(input.account, input.status)
  },

  'admin:suspend-activity': async (input: { id: number | string; reason: string }, context) => {
    requireAdmin(context)
    return suspendActivity(Number(input.id), input.reason)
  },

  'admin:restore-activity': async (input: { id: number | string }, context) => {
    requireAdmin(context)
    return restoreActivity(Number(input.id))
  },

  // ---------- 公共统计 ----------
  'stats:public': async (_payload, context) => {
    assertSessionUsable(context)
    try {
      return { registeredStudents: await getRegisteredStudentCount() }
    } catch {
      throw new Error('统计数据暂时不可用')
    }
  },
}

export function getChannelHandler(channel: string): ChannelHandler | undefined {
  return Object.prototype.hasOwnProperty.call(channels, channel) ? channels[channel] : undefined
}
