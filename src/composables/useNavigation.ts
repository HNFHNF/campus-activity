import { computed } from 'vue'
import { useStore } from './useStore'
import type { ViewName } from '../types'

export interface NavItem {
  view: ViewName
  label: string
  /** 移动端底部导航使用的短标签 */
  short: string
  icon: string
}

/**
 * 角色导航的唯一数据源。侧边栏（桌面）与底部导航（移动端）共用，
 * 避免 V2.0 中“窄屏直接隐藏侧边栏、却没有替代入口”的问题。
 */
export function useNavigation() {
  const { state, isTeacher, isAdmin } = useStore()

  const navItems = computed<NavItem[]>(() => {
    if (!state.currentUser) return []
    if (isAdmin.value) {
      return [
        { view: 'discover', label: '活动广场', short: '广场', icon: 'home' },
        { view: 'accounts', label: '账号管理', short: '账号', icon: 'users' },
        { view: 'governance', label: '违规活动治理', short: '治理', icon: 'edit' }
      ]
    }
    if (isTeacher.value) {
      return [
        { view: 'discover', label: '活动广场', short: '广场', icon: 'home' },
        { view: 'myActivities', label: '我的发布', short: '我的', icon: 'ticket' },
        { view: 'publish', label: '发布活动', short: '发布', icon: 'plus' },
        { view: 'manage', label: '活动管理', short: '管理', icon: 'edit' }
      ]
    }
    return [
      { view: 'discover', label: '活动广场', short: '广场', icon: 'home' },
      { view: 'myActivities', label: '我的活动', short: '我的', icon: 'ticket' },
      { view: 'notifications', label: '通知中心', short: '通知', icon: 'bell' }
    ]
  })

  return { navItems }
}
