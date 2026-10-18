import { reactive, computed, ref } from 'vue'
import { invoke, setAuthToken, setSessionExpiredHandler } from '../services/bridge'
import type {
  Activity,
  ActivityCategory,
  ApplyResult,
  NotificationItem,
  RegistrationStatus,
  StudentRegistration,
  User,
  ViewName
} from '../types'

export const categories: Record<ActivityCategory, { label: string; color: string }> = {
  academic: { label: '学术讲座', color: 'blue' },
  culture: { label: '文化艺术', color: 'badge' },
  sports: { label: '体育运动', color: 'green' },
  volunteer: { label: '志愿服务', color: 'green' },
  club: { label: '社团活动', color: 'gray' }
}

/** V3.0：活动广场的排序方式 */
export type ActivitySort = 'default' | 'time' | 'remaining' | 'deadline'
/** V3.0：我的活动按报名状态筛选 */
export type RegistrationFilter = 'all' | RegistrationStatus

/** 报名状态的统一文案，学生端随处可读 */
export const registrationLabels: Record<RegistrationStatus, string> = {
  confirmed: '正式报名',
  waitlisted: '候补中',
  pending: '待审核',
  rejected: '未通过'
}

/** 时间冲突判定口径：开始时间相差不足 2 小时（与数据分析口径一致） */
export const CONFLICT_WINDOW_HOURS = 2

const state = reactive({
  currentUser: null as User | null,
  activities: [] as Activity[],
  registrations: [] as StudentRegistration[],
  notifications: [] as NotificationItem[],
  currentView: 'discover' as ViewName,
  activeCategory: 'all' as ActivityCategory | 'all',
  searchQuery: '',
  onlyAvailable: false,
  weekendOnly: false,
  sortBy: 'default' as ActivitySort,
  myStatusFilter: 'all' as RegistrationFilter,
  editingActivity: null as Activity | null
})

const toast = ref('')
const applyingIds = reactive(new Set<number>())
const cancellingIds = reactive(new Set<number>())
const submitTokens = new Map<number, string>()
let toastTimer: number | undefined
let sessionExpiredBound = false

function createRequestToken(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function parseActivityTime(time: string): number | null {
  const parsed = new Date(time.includes('T') ? time : time.replace(' ', 'T')).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function isWeekend(time: string): boolean {
  const parsed = parseActivityTime(time)
  if (parsed === null) return false
  const day = new Date(parsed).getDay()
  return day === 0 || day === 6
}

function resetFilters() {
  state.activeCategory = 'all'
  state.searchQuery = ''
  state.onlyAvailable = false
  state.weekendOnly = false
  state.sortBy = 'default'
  state.myStatusFilter = 'all'
}

export function useStore() {
  // 令牌失效（例如后台服务重启）时自动退回登录页，避免按钮点了没反应
  if (!sessionExpiredBound) {
    sessionExpiredBound = true
    setSessionExpiredHandler(() => {
      state.currentUser = null
      state.registrations = []
      state.notifications = []
      state.currentView = 'discover'
      resetFilters()
      state.editingActivity = null
      applyingIds.clear()
      cancellingIds.clear()
      submitTokens.clear()
      showToast('登录状态已失效，请重新登录')
    })
  }

  const isLoggedIn = computed(() => state.currentUser !== null)
  const isTeacher = computed(() => state.currentUser?.role === 'teacher')
  const isAdmin = computed(() => state.currentUser?.role === 'admin')

  /** V3.0：未读通知数量，用于侧边栏 / 移动端“通知中心”徽标 */
  const unreadCount = computed(() => state.notifications.filter(n => !n.read).length)

  /** 活动广场只展示未被下架的活动 */
  const activeActivities = computed(() => state.activities.filter(a => a.status === 'active'))

  /** 有未读通知时的快捷提示 */
  const hasUnread = computed(() => unreadCount.value > 0)

  async function loadActivities() {
    const activities = await invoke<Activity[]>('activities:list')
    state.activities = Array.isArray(activities) ? activities : []
  }

  /**
   * V3.0：列表筛选。除类别与关键词外，新增“仅看有名额”“仅看周末”“按时间/剩余名额排序”，
   * 依据是反馈中“想找周末的活动/只想参加一类/要一条条打开看”的样本。
   */
  const filteredActivities = computed(() => {
    const query = state.searchQuery.trim().toLowerCase()
    const list = activeActivities.value.filter(a => {
      const matchCat = state.activeCategory === 'all' || a.category === state.activeCategory
      const matchSearch = !query ||
        a.title.toLowerCase().includes(query) ||
        a.location.toLowerCase().includes(query) ||
        a.organizer.toLowerCase().includes(query) ||
        a.desc.toLowerCase().includes(query) ||
        categories[a.category].label.includes(query)
      const matchAvailable = !state.onlyAvailable || a.enrolled < a.capacity
      const matchWeekend = !state.weekendOnly || isWeekend(a.time)
      return matchCat && matchSearch && matchAvailable && matchWeekend
    })
    const sorted = [...list]
    if (state.sortBy === 'time') {
      sorted.sort((a, b) => (parseActivityTime(a.time) ?? 0) - (parseActivityTime(b.time) ?? 0))
    } else if (state.sortBy === 'remaining') {
      sorted.sort((a, b) => (b.capacity - b.enrolled) - (a.capacity - a.enrolled))
    } else if (state.sortBy === 'deadline') {
      sorted.sort((a, b) => (parseActivityTime(a.deadline) ?? 0) - (parseActivityTime(b.deadline) ?? 0))
    }
    return sorted
  })

  const hasActiveFilters = computed(() =>
    state.activeCategory !== 'all' || Boolean(state.searchQuery.trim()) || state.onlyAvailable ||
    state.weekendOnly || state.sortBy !== 'default'
  )

  const myActivities = computed(() => {
    if (!state.currentUser) return []
    if (state.currentUser.role === 'student') {
      const ids = state.registrations.map(r => r.activityId)
      return state.activities.filter(a => ids.includes(a.id))
    }
    return state.activities.filter(a => a.teacherId === state.currentUser!.id)
  })

  const teacherActivities = computed(() => {
    if (!state.currentUser || state.currentUser.role !== 'teacher') return []
    return state.activities.filter(a => a.teacherId === state.currentUser!.id)
  })

  /** V3.0：我的活动按报名状态筛选，候补较多时学生可以快速只看候补 */
  const myFilteredActivities = computed(() => {
    if (isTeacher.value || isAdmin.value) return myActivities.value
    if (state.myStatusFilter === 'all') return myActivities.value
    return myActivities.value.filter(a => registrationOf(a.id)?.status === state.myStatusFilter)
  })

  const myStatusCounts = computed<Record<RegistrationFilter, number>>(() => {
    const counts: Record<RegistrationFilter, number> = {
      all: 0, confirmed: 0, waitlisted: 0, pending: 0, rejected: 0
    }
    if (isTeacher.value || isAdmin.value) return counts
    for (const registration of state.registrations) {
      counts.all += 1
      counts[registration.status] += 1
    }
    return counts
  })

  /**
   * V3.0：时间冲突聚合。已正式报名的活动之间，开始时间相差不足 2 小时即视为冲突，
   * 在“我的活动”里一次性列出，避免报名瞬间的一次性提示被遗忘。
   * 依据：数据分析中 407 名多活动报名学生里有 164 名（40.3%）存在该口径的冲突。
   */
  const scheduleConflicts = computed(() => {
    if (isTeacher.value || isAdmin.value) return []
    const confirmed = state.activities.filter(a => registrationOf(a.id)?.status === 'confirmed')
    const pairs: Array<{ first: Activity; second: Activity; gapHours: number }> = []
    for (let i = 0; i < confirmed.length; i += 1) {
      for (let j = i + 1; j < confirmed.length; j += 1) {
        const first = confirmed[i]
        const second = confirmed[j]
        const t1 = parseActivityTime(first.time)
        const t2 = parseActivityTime(second.time)
        if (t1 === null || t2 === null) continue
        const gap = Math.abs(t1 - t2)
        if (gap < CONFLICT_WINDOW_HOURS * 60 * 60 * 1000) {
          pairs.push({ first, second, gapHours: Math.round((gap / 3600000) * 10) / 10 })
        }
      }
    }
    return pairs
  })

  /** 冲突活动 id 集合，活动卡片上显示“时间冲突”标记 */
  const conflictActivityIds = computed(() => {
    const ids = new Set<number>()
    for (const pair of scheduleConflicts.value) {
      ids.add(pair.first.id)
      ids.add(pair.second.id)
    }
    return ids
  })

  function registrationOf(activityId: number): StudentRegistration | null {
    return state.registrations.find(r => r.activityId === activityId) ?? null
  }

  function registrationPosition(activityId: number): number | null {
    return registrationOf(activityId)?.position ?? null
  }

  function isApplying(activityId: number): boolean {
    return applyingIds.has(activityId)
  }

  function isCancelling(activityId: number): boolean {
    return cancellingIds.has(activityId)
  }

  /** 剩余名额（不会小于 0） */
  function remainingSpots(activity: Activity): number {
    return Math.max(0, activity.capacity - activity.enrolled)
  }

  /**
   * V3.0：满员/候补较多时推荐同类且仍有余量的活动。
   * 依据：数据分析显示 5 个热门活动占 35.3% 的去重申请与 87.9% 的最终候补，
   * 给被挡在门外的学生一个更可执行的替代选择。
   */
  function alternativesFor(activity: Activity, limit = 3): Activity[] {
    return activeActivities.value
      .filter(item =>
        item.id !== activity.id &&
        item.category === activity.category &&
        item.enrolled < item.capacity &&
        !registrationOf(item.id)
      )
      .sort((a, b) => (parseActivityTime(a.time) ?? 0) - (parseActivityTime(b.time) ?? 0))
      .slice(0, limit)
  }

  function setRegistration(registration: StudentRegistration) {
    const index = state.registrations.findIndex(r => r.activityId === registration.activityId)
    if (index >= 0) state.registrations[index] = registration
    else state.registrations.push(registration)
  }

  async function login(user: User, token: string) {
    setAuthToken(token)
    state.currentUser = user
    try {
      state.registrations = user.role === 'student'
        ? await invoke<StudentRegistration[]>('activities:registrations')
        : []
    } catch {
      state.registrations = []
    }
    state.notifications = user.role === 'student' ? await loadNotifications() : []
    state.currentView = user.role === 'admin' ? 'accounts' : 'discover'
    resetFilters()
    try {
      await loadActivities()
    } catch {
      // 活动列表加载失败不阻断登录，后续切换视图时会再次尝试
    }
  }

  async function logout() {
    try {
      await invoke('auth:logout')
    } catch {
      // 会话已失效时忽略
    }
    setAuthToken(null)
    state.currentUser = null
    state.registrations = []
    state.notifications = []
    state.currentView = 'discover'
    resetFilters()
    applyingIds.clear()
    cancellingIds.clear()
    submitTokens.clear()
  }

  function switchView(view: ViewName) {
    state.currentView = view
    if (view === 'notifications') void loadNotifications()
    if (view === 'discover') void loadActivities()
  }

  function clearFilters() {
    resetFilters()
  }

  /** V3.0：拉取当前用户的站内通知（报名状态变化提醒） */
  async function loadNotifications(): Promise<NotificationItem[]> {
    if (!state.currentUser) return []
    try {
      const list = await invoke<NotificationItem[]>('notifications:list')
      state.notifications = Array.isArray(list) ? list : []
    } catch {
      state.notifications = []
    }
    return state.notifications
  }

  /** V3.0：把单条通知标记为已读 */
  async function markNotificationRead(id: number) {
    try {
      await invoke('notifications:mark-read', { id })
    } catch {
      return
    }
    const item = state.notifications.find(n => n.id === id)
    if (item) item.read = true
  }

  /** V3.0：一键全部已读 */
  async function markAllNotificationsRead() {
    try {
      await invoke('notifications:mark-read', {})
    } catch {
      return
    }
    state.notifications.forEach(n => { n.read = true })
  }

  /**
   * V3.0：报名提交。
   * - 前端生成 requestId，并在一次提交的生命周期内复用；网络失败重试不会产生第二条报名；
   * - 服务端命中幂等记录时返回 reused=true；
   * - 返回 { result, error }，详情页据此展示“提交中/成功回执/失败原因”，而不是只弹一个 toast。
   */
  async function apply(activityId: number): Promise<{ result: ApplyResult | null; error: string | null }> {
    if (!state.currentUser || state.currentUser.role !== 'student') {
      return { result: null, error: '只有学生可以报名活动' }
    }
    if (applyingIds.has(activityId)) return { result: null, error: null }
    const existing = registrationOf(activityId)
    if (existing && existing.status !== 'rejected') {
      return { result: null, error: '你已经报名该活动，可在“我的活动”查看状态' }
    }
    const requestId = submitTokens.get(activityId) ?? createRequestToken()
    submitTokens.set(activityId, requestId)
    applyingIds.add(activityId)
    let registration: ApplyResult
    try {
      registration = await invoke<ApplyResult>('activities:apply', { activityId, requestId })
    } catch (error) {
      // 保留 requestId：用户点击“重试”时复用同一令牌，服务端不会重复创建报名
      applyingIds.delete(activityId)
      const message = error instanceof Error ? error.message : '报名失败，请稍后重试'
      showToast(message)
      return { result: null, error: message }
    }
    applyingIds.delete(activityId)
    submitTokens.delete(activityId)
    setRegistration(registration)
    try {
      await Promise.all([loadActivities(), loadNotifications()])
    } catch {
      // 状态已写入，列表刷新失败不改变“报名已成功”的事实；后续切换视图会再次加载
    }

    const act = state.activities.find(a => a.id === activityId)
    if (registration.reused) {
      showToast(`已确认你的报名状态：${registrationLabels[registration.status]}，无需重复提交`)
      return { result: registration, error: null }
    }
    if (registration.status === 'confirmed' && act) {
      const targetStart = parseActivityTime(act.time)
      const conflict = targetStart === null ? undefined : state.activities.find(other => {
        const otherRegistration = registrationOf(other.id)
        if (other.id === activityId || otherRegistration?.status !== 'confirmed') return false
        const otherStart = parseActivityTime(other.time)
        return otherStart !== null &&
          Math.abs(otherStart - targetStart) < CONFLICT_WINDOW_HOURS * 60 * 60 * 1000
      })
      if (conflict) showToast(`报名成功。提示：与“${conflict.title}”开始时间相差不足 2 小时`)
      else showToast('报名成功！')
    } else if (registration.status === 'waitlisted') {
      showToast(`活动已满员，已进入候补队列第 ${registration.position ?? '-'} 位`)
    } else if (registration.status === 'pending') {
      showToast('已提交报名申请，等待组织教师审核')
    }
    return { result: registration, error: null }
  }

  /** 取消报名 / 退出候补 / 撤回待审核申请 */
  async function cancel(activityId: number): Promise<boolean> {
    const current = registrationOf(activityId)
    if (!current || cancellingIds.has(activityId)) return false
    cancellingIds.add(activityId)
    let result: { previous: RegistrationStatus; promoted: Array<{ account: string; name: string }> }
    try {
      result = await invoke<{ previous: RegistrationStatus; promoted: Array<{ account: string; name: string }> }>(
        'activities:cancel',
        { activityId }
      )
    } catch (error) {
      cancellingIds.delete(activityId)
      showToast(error instanceof Error ? error.message : '操作失败，请稍后重试')
      return false
    }
    cancellingIds.delete(activityId)
    state.registrations = state.registrations.filter(r => r.activityId !== activityId)
    submitTokens.delete(activityId)
    try {
      await Promise.all([loadActivities(), loadNotifications()])
    } catch {
      // 取消已生效，刷新失败时保留当前状态，后续切换视图会再次加载
    }

    if (result.previous === 'waitlisted') showToast('已退出候补队列')
    else if (result.previous === 'pending') showToast('已撤回报名申请')
    else if (result.promoted.length > 0) showToast(`已取消报名，候补第 1 位“${result.promoted[0].name}”已自动转为正式`)
    else showToast('已取消报名')
    return true
  }

  async function publishActivity(activity: Omit<Activity, 'id' | 'enrolled' | 'status' | 'suspendedReason' | 'waitlistCount'>) {
    const newActivity = await invoke<Activity>('activities:create', activity)
    state.activities.unshift(newActivity)
    showToast('活动发布成功')
    return newActivity
  }

  async function updateActivity(activity: Activity) {
    const updated = await invoke<Activity>('activities:update', activity)
    const index = state.activities.findIndex(item => item.id === updated.id)
    if (index >= 0) state.activities[index] = updated
    state.editingActivity = null
    showToast('活动信息已更新')
    return updated
  }

  function beginEditActivity(activity: Activity) {
    state.editingActivity = { ...activity }
    state.currentView = 'publish'
  }

  function cancelEditActivity() {
    state.editingActivity = null
  }

  async function deleteActivity(id: number) {
    await invoke('activities:delete', id)
    state.activities = state.activities.filter(a => a.id !== id)
    state.registrations = state.registrations.filter(r => r.activityId !== id)
    showToast('活动已删除')
  }

  /** 教师审核本人活动的报名申请 */
  async function reviewRegistration(activityId: number, studentAccount: string, decision: 'approve' | 'reject') {
    const result = await invoke<{ name: string; status: RegistrationStatus }>(
      'activities:review',
      { activityId, studentAccount, decision }
    )
    await loadActivities()
    showToast(decision === 'approve'
      ? (result.status === 'confirmed' ? `已通过“${result.name}”的报名` : `名额已满，“${result.name}”已转为候补`)
      : `已标记“${result.name}”为未通过`)
    return result
  }

  /** 管理员：账号启停 */
  async function setAccountStatus(account: string, status: 'active' | 'disabled') {
    await invoke('admin:set-account-status', { account, status })
    showToast(status === 'disabled' ? '账号已停用' : '账号已启用')
  }

  /** 管理员：违规活动治理 */
  async function suspendActivity(id: number, reason: string) {
    await invoke('admin:suspend-activity', { id, reason })
    await loadActivities()
    showToast('活动已下架')
  }

  async function restoreActivity(id: number) {
    await invoke('admin:restore-activity', { id })
    await loadActivities()
    showToast('活动已恢复')
  }

  function showToast(msg: string) {
    toast.value = msg
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => { toast.value = '' }, 3600)
  }

  return {
    state,
    toast,
    isLoggedIn,
    isTeacher,
    isAdmin,
    unreadCount,
    hasUnread,
    categories,
    registrationLabels,
    loadActivities,
    loadNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    activeActivities,
    filteredActivities,
    hasActiveFilters,
    clearFilters,
    myActivities,
    myFilteredActivities,
    myStatusCounts,
    teacherActivities,
    scheduleConflicts,
    conflictActivityIds,
    alternativesFor,
    remainingSpots,
    registrationOf,
    registrationPosition,
    isApplying,
    isCancelling,
    login,
    logout,
    switchView,
    apply,
    cancel,
    publishActivity,
    updateActivity,
    beginEditActivity,
    cancelEditActivity,
    deleteActivity,
    reviewRegistration,
    setAccountStatus,
    suspendActivity,
    restoreActivity,
    showToast
  }
}
