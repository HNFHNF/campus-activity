<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useStore } from '../composables/useStore'
import { formatDate } from '../utils/format'
import type { NotificationItem, NotificationType } from '../types'

const { state, unreadCount, loadNotifications, markNotificationRead, markAllNotificationsRead, switchView } = useStore()

const filter = ref<'all' | 'unread'>('all')
const loading = ref(true)

const typeMeta: Record<NotificationType, { icon: string; label: string; tone: string }> = {
  waitlist_promoted: { icon: '🎉', label: '候补递补', tone: 'green' },
  review_approved: { icon: '✅', label: '审核通过', tone: 'green' },
  review_rejected: { icon: '⛔', label: '审核未通过', tone: 'red' },
  registration_resolved: { icon: '🔄', label: '状态自动变更', tone: 'blue' },
  activity_suspended: { icon: '⚠️', label: '活动下架', tone: 'red' }
}

const fallbackMeta = { icon: '🔔', label: '状态通知', tone: 'blue' }

function metaOf(item: NotificationItem) {
  return typeMeta[item.type] ?? fallbackMeta
}

const list = computed(() => filter.value === 'unread'
  ? state.notifications.filter(n => !n.read)
  : state.notifications)

const counts = computed(() => ({
  total: state.notifications.length,
  unread: unreadCount.value,
  promoted: state.notifications.filter(n => n.type === 'waitlist_promoted').length,
  review: state.notifications.filter(n => n.type === 'review_approved' || n.type === 'review_rejected').length
}))

onMounted(async () => {
  loading.value = true
  try {
    await loadNotifications()
  } finally {
    loading.value = false
  }
})

async function openItem(id: number, activityId: number | null) {
  if (state.notifications.find(n => n.id === id && !n.read)) await markNotificationRead(id)
  if (activityId) switchView('myActivities')
}
</script>

<template>
  <section class="view">
    <div class="topbar">
      <div>
        <h1>通知中心</h1>
        <p class="sub">候补递补、审核结果、关闭审核后的自动处理、活动下架都会在这里留下记录，不必再反复刷新页面。</p>
      </div>
      <button class="btn btn-secondary" :disabled="unreadCount === 0" @click="markAllNotificationsRead">
        全部标为已读<template v-if="unreadCount"> ({{ unreadCount }})</template>
      </button>
    </div>

    <div class="summary-row">
      <div class="summary-item"><span>全部通知</span><strong>{{ counts.total }}</strong></div>
      <div class="summary-item accent"><span>未读</span><strong>{{ counts.unread }}</strong></div>
      <div class="summary-item"><span>候补递补</span><strong>{{ counts.promoted }}</strong></div>
      <div class="summary-item"><span>审核结果</span><strong>{{ counts.review }}</strong></div>
    </div>

    <div class="filter-row">
      <button class="chip" :class="{ active: filter === 'all' }" @click="filter = 'all'">
        全部 {{ state.notifications.length }}
      </button>
      <button class="chip" :class="{ active: filter === 'unread' }" @click="filter = 'unread'">
        未读 {{ unreadCount }}
      </button>
    </div>

    <div v-if="loading" class="empty-state card">加载中...</div>

    <div v-else-if="list.length === 0" class="empty-state card">
      <div class="icon">🔔</div>
      <h3>{{ filter === 'unread' ? '没有未读通知' : '暂时还没有通知' }}</h3>
      <p>当你的报名状态发生变化时，这里会第一时间提醒你</p>
    </div>

    <ul v-else class="notice-list">
      <li
        v-for="item in list"
        :key="item.id"
        class="notice card"
        :class="{ unread: !item.read, [`tone-${metaOf(item).tone}`]: true }"
        @click="openItem(item.id, item.activityId)"
      >
        <span class="notice-icon">{{ metaOf(item).icon }}</span>
        <div class="notice-body">
          <div class="notice-head">
            <strong>{{ item.title }}</strong>
            <span class="badge" :class="`badge-${metaOf(item).tone === 'green' ? 'green' : metaOf(item).tone === 'red' ? 'red' : 'blue'}`">
              {{ metaOf(item).label }}
            </span>
            <span v-if="!item.read" class="dot-unread" aria-label="未读"></span>
          </div>
          <p>{{ item.body }}</p>
          <div class="notice-time">{{ formatDate(item.createdAt) }}</div>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.view { animation: fadeIn 0.35s ease; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  gap: 16px;
  flex-wrap: wrap;
}

.topbar h1 { font-size: 1.9rem; font-weight: 700; letter-spacing: -0.03em; }
.sub { color: var(--text-500); font-size: 0.93rem; max-width: 720px; line-height: 1.6; }

.summary-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.summary-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--bg-300);
  background: var(--bg-50);
  color: var(--text-500);
  font-size: 0.84rem;
  font-weight: 600;
}

.summary-item strong { font-size: 1.3rem; color: var(--text-800); letter-spacing: -0.02em; }
.summary-item.accent { border-color: rgba(0,122,255,.35); background: var(--brand-50); }
.summary-item.accent strong { color: var(--brand-700); }

.filter-row { display: flex; gap: 10px; margin-bottom: 20px; }
.chip {
  padding: 8px 16px; border-radius: 9999px; border: 1px solid var(--bg-300);
  background: var(--bg-50); color: var(--text-600); font-weight: 600; font-size: 0.88rem; cursor: pointer;
  transition: all 0.2s ease;
}
.chip:hover { border-color: var(--brand-300); color: var(--brand-600); }
.chip.active { background: var(--brand-500); color: #fff; border-color: var(--brand-500); }

.notice-list { list-style: none; display: flex; flex-direction: column; gap: 14px; }

.notice {
  display: flex;
  gap: 16px;
  padding: 20px 22px;
  cursor: pointer;
  border-left: 4px solid transparent;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}
.notice:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg, 0 12px 28px rgba(29,48,80,.10)); }
.notice.unread { background: linear-gradient(90deg, rgba(0,122,255,.06), transparent 55%); }
.notice.unread.tone-green { border-left-color: #34c759; }
.notice.unread.tone-red { border-left-color: #ff3b30; }
.notice.unread.tone-blue { border-left-color: #007aff; }

.notice-icon { font-size: 1.6rem; line-height: 1.2; flex: none; }
.notice-body { min-width: 0; flex: 1; }
.notice-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.notice-head strong { font-size: 1rem; color: var(--text-800); }
.notice-body p { color: var(--text-600); font-size: 0.9rem; line-height: 1.65; }
.notice-time { margin-top: 8px; color: var(--text-500); font-size: 0.78rem; }
.dot-unread { width: 8px; height: 8px; border-radius: 50%; background: var(--brand-500); }

.empty-state { text-align: center; padding: 70px 20px; color: var(--text-500); }
.empty-state .icon {
  width: 80px; height: 80px; margin: 0 auto 20px; border-radius: 50%;
  background: var(--bg-200); display: flex; align-items: center; justify-content: center; font-size: 2.2rem;
}
.empty-state h3 { color: var(--text-800); font-size: 1.2rem; margin-bottom: 8px; }

@media (max-width: 640px) {
  .topbar h1 { font-size: 1.6rem; }
  .summary-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .notice { padding: 16px; gap: 12px; }
  .notice-icon { font-size: 1.3rem; }
}
</style>
