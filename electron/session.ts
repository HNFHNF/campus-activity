/**
 * 极简登录会话：登录成功后发放随机令牌，后续所有业务调用都带上令牌，
 * 服务端据此解析出操作者身份，用于执行“学生只能操作自己的报名、
 * 教师只能管理自己发布的活动、管理员只做账号启停与违规治理”这些边界。
 * 会话保存在内存中，程序重启后需要重新登录。
 */
import crypto from 'node:crypto'
import type { Actor } from './database'

const sessions = new Map<string, Actor>()

export function createSession(actor: Actor) {
  const token = crypto.randomBytes(32).toString('hex')
  sessions.set(token, actor)
  return token
}

export function resolveActor(token: unknown): Actor | null {
  if (typeof token !== 'string' || !token) return null
  return sessions.get(token) ?? null
}

export function destroySession(token: unknown) {
  if (typeof token === 'string' && token) sessions.delete(token)
}
