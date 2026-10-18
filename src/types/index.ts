export type UserRole = 'student' | 'teacher' | 'admin'

export interface User {
  id: string
  name: string
  role: UserRole
  avatar: string
}

export interface StudentRecord {
  id: number
  account: string
  name: string
  email: string
  createdAt: string
  status: AccountStatus
}

export type AccountStatus = 'active' | 'disabled'

/** 报名状态：正式 / 候补 / 待审核 / 未通过 */
export type RegistrationStatus = 'confirmed' | 'waitlisted' | 'pending' | 'rejected'

export interface StudentRegistration {
  activityId: number
  status: RegistrationStatus
  /** 候补时的队列序号（从 1 开始），其他状态为 null */
  position: number | null
  registeredAt: string
  reviewedAt: string | null
  /** V3.0：最近一次状态变化时间，用于让学生判断“这条状态是不是刚变的” */
  statusUpdatedAt: string
  /** V3.0：最近一次提交的请求令牌（服务端按它做幂等去重） */
  requestId: string | null
}

/** V3.0：报名提交结果。reused = 命中了服务端幂等记录或已有报名，本次没有创建新报名 */
export interface ApplyResult extends StudentRegistration {
  reused: boolean
}

export interface ActivityRegistrant {
  id: number
  account: string
  name: string
  email: string
  registeredAt: string
  status: RegistrationStatus
  /** 候补时的队列序号（从 1 开始），其他状态为 null */
  position: number | null
}

export type ActivityCategory = 'academic' | 'culture' | 'sports' | 'volunteer' | 'club'

export interface Activity {
  id: number
  title: string
  category: ActivityCategory
  desc: string
  time: string
  location: string
  capacity: number
  enrolled: number
  deadline: string
  organizer: string
  icon: string
  teacherId: string | null
  /** 该活动是否开启报名审核：开启后报名先进入待审核，教师通过时再按剩余名额决定正式或候补 */
  reviewEnabled: boolean
  /** active = 正常；suspended = 被管理员下架治理 */
  status: ActivityStatus
  suspendedReason: string | null
  /** V3.0：当前候补人数（列表接口附带，用于学生端判断热门程度与备选） */
  waitlistCount?: number
}

export type ActivityStatus = 'active' | 'suspended'

export type ViewName = 'discover' | 'myActivities' | 'publish' | 'manage' | 'accounts' | 'governance' | 'notifications'

/** V3.0：报名状态变化产生的站内通知类型 */
export type NotificationType =
  | 'waitlist_promoted'
  | 'review_approved'
  | 'review_rejected'
  | 'registration_resolved'
  | 'activity_suspended'

export interface NotificationItem {
  id: number
  type: NotificationType
  title: string
  body: string
  activityId: number | null
  read: boolean
  createdAt: string
}

/** V3.0：教师端单个活动的报名结构概览 */
export interface ActivityOverview {
  activityId: number
  capacity: number
  applied: number
  confirmed: number
  waitlisted: number
  pending: number
  rejected: number
}
