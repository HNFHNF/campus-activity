<script setup lang="ts">
import { computed } from 'vue'
import { useStore, registrationLabels, CONFLICT_WINDOW_HOURS } from '../composables/useStore'
import type { RegistrationFilter } from '../composables/useStore'
import ActivityCard from './ActivityCard.vue'
import type { Activity } from '../types'

const props = defineProps<{
  onShowDetail: (a: Activity) => void
}>()

const {
  state, isTeacher, beginEditActivity, scheduleConflicts, conflictActivityIds,
  unreadCount, switchView, myActivities, myFilteredActivities, myStatusCounts
} = useStore()

const title = computed(() => isTeacher.value ? '我的发布' : '我的活动')
const subtitle = computed(() => isTeacher.value ? '管理你创建和发布的所有活动' : '查看你已报名参加的活动，状态变化会同步到通知中心')
const emptyIcon = computed(() => isTeacher.value ? '📝' : '🎫')
const emptyTitle = computed(() => {
  if (isTeacher.value) return '还没有发布过活动'
  if (state.myStatusFilter !== 'all') return `没有${registrationLabels[state.myStatusFilter as Exclude<RegistrationFilter, 'all'>]}的活动`
  return '还没有报名任何活动'
})
const emptyDesc = computed(() => isTeacher.value ? '点击左侧“发布活动”开始创建第一个活动' : '去活动广场发现感兴趣的活动吧')

const statusTabs = computed<Array<{ key: RegistrationFilter; label: string }>>(() => [
  { key: 'all', label: '全部' },
  { key: 'confirmed', label: '正式报名' },
  { key: 'waitlisted', label: '候补中' },
  { key: 'pending', label: '待审核' },
  { key: 'rejected', label: '未通过' }
])
</script>

<template>
  <section class="view">
    <div class="topbar">
      <div>
        <h1>{{ title }}</h1>
        <p class="sub">{{ subtitle }}</p>
      </div>
      <span v-if="!isTeacher" class="count-pill">共 {{ myActivities.length }} 个活动</span>
    </div>

    <div v-if="!isTeacher && unreadCount > 0" class="hint-card hint-blue" @click="switchView('notifications')">
      <span class="hint-icon">🔔</span>
      <div>
        <strong>你有 {{ unreadCount }} 条未读通知</strong>
        <p>候补递补、审核结果等状态变化都会在这里提醒你，点此查看。</p>
      </div>
    </div>

    <div v-if="!isTeacher && scheduleConflicts.length > 0" class="hint-card hint-amber">
      <span class="hint-icon">⏰</span>
      <div>
        <strong>检测到 {{ scheduleConflicts.length }} 组时间冲突</strong>
        <p>以下已报名活动的开始时间相差不足 {{ CONFLICT_WINDOW_HOURS }} 小时，请提前取舍，避免两边都参加不了：</p>
        <ul class="conflict-list">
          <li v-for="(pair, index) in scheduleConflicts" :key="index">
            「{{ pair.first.title }}」 与 「{{ pair.second.title }}」
            <span class="conflict-gap">相隔 {{ pair.gapHours }} 小时</span>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="!isTeacher" class="status-tabs" role="group" aria-label="按报名状态筛选">
      <button
        v-for="tab in statusTabs"
        :key="tab.key"
        class="status-tab"
        :class="{ active: state.myStatusFilter === tab.key }"
        @click="state.myStatusFilter = tab.key"
      >
        {{ tab.label }}
        <span class="tab-count">{{ myStatusCounts[tab.key] }}</span>
      </button>
    </div>

    <div class="activity-grid">
      <div v-for="activity in (isTeacher ? myActivities : myFilteredActivities)" :key="activity.id" class="activity-item">
        <ActivityCard
          :activity="activity"
          hide-registered
          :conflict="conflictActivityIds.has(activity.id)"
          @click="(a: Activity) => props.onShowDetail(a)"
        />
        <button v-if="isTeacher" class="edit-button" @click.stop="beginEditActivity(activity)">✎ 编辑活动</button>
      </div>
      <div v-if="(isTeacher ? myActivities : myFilteredActivities).length === 0" class="empty-state" style="grid-column:1/-1">
        <div class="icon">{{ emptyIcon }}</div>
        <h3>{{ emptyTitle }}</h3>
        <p>{{ emptyDesc }}</p>
        <button v-if="!isTeacher && state.myStatusFilter !== 'all'" class="btn btn-secondary" style="margin-top:16px" @click="state.myStatusFilter = 'all'">查看全部报名</button>
      </div>
    </div>
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
  margin-bottom: 24px;
  gap: 12px;
}

.topbar h1 {
  font-size: 1.9rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.sub { color: var(--text-500); font-size: 0.95rem; }

.count-pill {
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--bg-200);
  color: var(--text-600);
  font-size: 0.8rem;
  font-weight: 700;
  white-space: nowrap;
}

.hint-card {
  display: flex;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 14px;
  border: 1px solid var(--bg-300);
  margin-bottom: 16px;
  background: var(--bg-50);
}
.hint-blue { border-color: rgba(0,122,255,.35); background: rgba(0,122,255,.06); cursor: pointer; }
.hint-blue:hover { background: rgba(0,122,255,.10); }
.hint-amber { border-color: rgba(255,149,0,.40); background: rgba(255,149,0,.08); }
.hint-icon { font-size: 1.5rem; line-height: 1.2; flex: none; }
.hint-card strong { display: block; color: var(--text-800); margin-bottom: 4px; font-size: 0.98rem; }
.hint-card p { color: var(--text-600); font-size: 0.88rem; line-height: 1.6; margin: 0; }
.conflict-list { margin: 10px 0 0; padding-left: 18px; color: var(--text-700); font-size: 0.87rem; line-height: 1.9; }
.conflict-gap { color: #b26a00; font-weight: 700; margin-left: 6px; }

.status-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 22px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
}
.status-tabs::-webkit-scrollbar { display: none; }

.status-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: none;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--bg-300);
  background: var(--bg-50);
  color: var(--text-600);
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}

.status-tab.active {
  background: var(--brand-500);
  border-color: var(--brand-500);
  color: #fff;
}

.tab-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--bg-200);
  color: var(--text-600);
  font-size: 0.7rem;
  line-height: 18px;
  text-align: center;
}

.status-tab.active .tab-count { background: rgba(255,255,255,.24); color: #fff; }

.activity-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.activity-item { position: relative; min-width: 0; }
.activity-item :deep(.activity-card .body) { padding-bottom: 58px; }
.edit-button { position: absolute; right: 14px; bottom: 14px; z-index: 2; border: 1px solid var(--brand-200); border-radius: 9px; background: rgba(255,255,255,.96); color: var(--brand-600); padding: 6px 9px; font-size: 0.75rem; font-weight: 700; cursor: pointer; box-shadow: var(--shadow-xs); }
.edit-button:hover { background: var(--brand-50); }

.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: var(--text-500);
}

.empty-state .icon {
  width: 88px;
  height: 88px;
  margin: 0 auto 20px;
  border-radius: 50%;
  background: var(--bg-200);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.4rem;
}

.empty-state h3 { color: var(--text-800); font-size: 1.2rem; margin-bottom: 8px; }

@media (max-width: 640px) {
  .activity-grid { grid-template-columns: 1fr; }
  .topbar h1 { font-size: 1.6rem; }
  .topbar { align-items: flex-start; }
}
</style>
