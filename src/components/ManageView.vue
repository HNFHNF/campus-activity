<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useStore, categories } from '../composables/useStore'
import { invoke } from '../services/bridge'
import { formatDate } from '../utils/format'
import type { Activity, ActivityOverview, ActivityRegistrant } from '../types'

const props = defineProps<{
  onShowDetail: (a: Activity) => void
}>()

const { teacherActivities, deleteActivity, switchView, reviewRegistration, showToast } = useStore()
const registrants = ref<ActivityRegistrant[]>([])
const registrantsActivity = ref<Activity | null>(null)
const loadingRegistrants = ref(false)
const refreshing = ref(false)

/** V3.0：每个活动的报名结构（申请/正式/候补/待审核），用于发现候补与审核积压、判断供需失衡 */
const overviews = ref<Record<number, ActivityOverview>>({})

async function loadOverviews() {
  try {
    const list = await invoke<ActivityOverview[]>('activities:overview')
    const map: Record<number, ActivityOverview> = {}
    list.forEach(item => { map[item.activityId] = item })
    overviews.value = map
  } catch {
    overviews.value = {}
  }
}

async function refreshOverviews() {
  refreshing.value = true
  try {
    await loadOverviews()
  } finally {
    refreshing.value = false
  }
}

onMounted(loadOverviews)
watch(teacherActivities, () => { void loadOverviews() })

function overviewOf(id: number): ActivityOverview {
  return overviews.value[id] ?? { activityId: id, capacity: 0, applied: 0, confirmed: 0, waitlisted: 0, pending: 0, rejected: 0 }
}

function demandRatio(item: ActivityOverview): number {
  return item.capacity > 0 ? Math.round((item.applied / item.capacity) * 10) / 10 : 0
}

function backlogScore(item: ActivityOverview): number {
  return item.waitlisted + item.pending
}

/** V3.0：候补积压、待审核积压与供需失衡，提示教师需要优先处理的活动 */
const backlog = computed(() => {
  const list = Object.values(overviews.value)
  return {
    waitlisted: list.reduce((sum, item) => sum + item.waitlisted, 0),
    pending: list.reduce((sum, item) => sum + item.pending, 0),
    hot: list.filter(item => demandRatio(item) >= 2).length
  }
})

const backlogActivities = computed(() => Object.values(overviews.value)
  .filter(item => backlogScore(item) > 0 || demandRatio(item) >= 2)
  .sort((a, b) => backlogScore(b) - backlogScore(a) || demandRatio(b) - demandRatio(a))
  .slice(0, 5)
  .map(item => ({
    ...item,
    demandRatio: demandRatio(item),
    title: teacherActivities.value.find(a => a.id === item.activityId)?.title ?? `#${item.activityId}`
  })))


const statusLabel: Record<string, string> = { confirmed: '正式', waitlisted: '候补', pending: '待审核', rejected: '未通过' }
const statusClass: Record<string, string> = { confirmed: 'badge-green', waitlisted: 'badge-blue', pending: 'badge-gray', rejected: 'badge-red' }

const registrantCounts = computed(() => ({
  confirmed: registrants.value.filter(item => item.status === 'confirmed').length,
  waitlisted: registrants.value.filter(item => item.status === 'waitlisted').length,
  pending: registrants.value.filter(item => item.status === 'pending').length
}))

const stats = computed(() => {
  const acts = teacherActivities.value
  const totalCapacity = acts.reduce((s, a) => s + a.capacity, 0)
  const totalEnrolled = acts.reduce((s, a) => s + a.enrolled, 0)
  return {
    count: acts.length,
    capacity: totalCapacity,
    enrolled: totalEnrolled,
    full: acts.filter(a => a.enrolled >= a.capacity).length
  }
})

async function onDelete(id: number) {
  if (confirm('确定要删除这个活动吗？此操作不可撤销。')) {
    await deleteActivity(id)
  }
}

async function viewRegistrants(activity: Activity) {
  registrantsActivity.value = activity
  loadingRegistrants.value = true
  try {
    registrants.value = await invoke<ActivityRegistrant[]>('activities:registrants', activity.id)
  } finally {
    loadingRegistrants.value = false
  }
}

function closeRegistrants() {
  registrantsActivity.value = null
  registrants.value = []
}

async function review(student: ActivityRegistrant, decision: 'approve' | 'reject') {
  const activity = registrantsActivity.value
  if (!activity) return
  try {
    await reviewRegistration(activity.id, student.account, decision)
    await viewRegistrants(activity)
    await loadOverviews()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '审核失败，请稍后重试')
  }
}
</script>

<template>
  <section class="view">
    <div class="topbar">
      <div>
        <h1>活动管理</h1>
        <p class="sub">查看、编辑和删除你发布的活动</p>
      </div>
      <div class="topbar-actions">
        <button class="btn btn-secondary" :disabled="refreshing" @click="refreshOverviews">{{ refreshing ? '刷新中…' : '↻ 刷新数据' }}</button>
        <button class="btn btn-primary" @click="switchView('publish')">+ 发布新活动</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card card">
        <div class="stat-label">已发布活动</div>
        <div class="stat-value">{{ stats.count }}</div>
      </div>
      <div class="stat-card card">
        <div class="stat-label">总名额</div>
        <div class="stat-value">{{ stats.capacity }}</div>
      </div>
      <div class="stat-card card">
        <div class="stat-label">已报名人数</div>
        <div class="stat-value">{{ stats.enrolled }}</div>
      </div>
      <div class="stat-card card">
        <div class="stat-label">已满员活动</div>
        <div class="stat-value">{{ stats.full }}</div>
      </div>
      <div class="stat-card card" :class="{ alert: backlog.waitlisted > 0 }">
        <div class="stat-label">候补积压人次</div>
        <div class="stat-value">{{ backlog.waitlisted }}</div>
      </div>
      <div class="stat-card card" :class="{ alert: backlog.pending > 0 }">
        <div class="stat-label">待审核申请</div>
        <div class="stat-value">{{ backlog.pending }}</div>
      </div>
      <div class="stat-card card" :class="{ alert: backlog.hot > 0 }">
        <div class="stat-label">供需比 ≥ 2 的活动</div>
        <div class="stat-value">{{ backlog.hot }}</div>
      </div>
    </div>

    <div v-if="backlogActivities.length > 0" class="backlog-card card">
      <div class="backlog-head">
        <span class="dot"></span>
        <strong>需要优先关注的活动</strong>
        <small>按候补/待审核数量与供需比排序</small>
      </div>
      <ul class="backlog-list">
        <li v-for="item in backlogActivities" :key="item.activityId">
          <span class="backlog-title">{{ item.title }}</span>
          <span class="backlog-tags">
            <span v-if="item.demandRatio >= 2" class="badge badge-red">供需 {{ item.demandRatio }}</span>
            <span v-if="item.waitlisted" class="badge badge-blue">候补 {{ item.waitlisted }}</span>
            <span v-if="item.pending" class="badge badge-gray">待审核 {{ item.pending }}</span>
          </span>
        </li>
      </ul>
      <p class="backlog-tip">
        供需比 ≥ 2 说明申请人数至少是名额的两倍：可考虑增加名额、加开场次，或提前告知学生候补风险；
        待审核申请建议尽快处理，避免学生错过活动。
      </p>
    </div>

    <div class="table-card card">
      <table class="activity-table">
        <thead>
          <tr>
            <th>活动</th>
            <th>时间</th>
            <th>地点</th>
            <th>报名结构</th>
            <th>状态</th>
            <th style="width:120px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="activity in teacherActivities" :key="activity.id">
            <td>
              <div class="activity-name">
                <span class="activity-icon">{{ activity.icon }}</span>
                <div>
                  <div class="title">{{ activity.title }}</div>
                  <div class="meta">{{ categories[activity.category].label }} · {{ activity.organizer }}</div>
                </div>
              </div>
            </td>
            <td>{{ formatDate(activity.time) }}</td>
            <td>{{ activity.location }}</td>
            <td>
              <button class="enrollment-link" @click="viewRegistrants(activity)">
                {{ overviewOf(activity.id).confirmed || activity.enrolled }} / {{ overviewOf(activity.id).capacity || activity.capacity }}
              </button>
              <div class="enroll-sub">
                <span class="sub-applied">申请 {{ overviewOf(activity.id).applied }}</span>
                <span v-if="overviewOf(activity.id).waitlisted" class="sub-wait">候补 {{ overviewOf(activity.id).waitlisted }}</span>
                <span v-if="overviewOf(activity.id).pending" class="sub-pending">待审核 {{ overviewOf(activity.id).pending }}</span>
                <span v-if="demandRatio(overviewOf(activity.id)) >= 2" class="sub-hot">供需 {{ demandRatio(overviewOf(activity.id)) }}</span>
                <span v-if="!overviewOf(activity.id).waitlisted && !overviewOf(activity.id).pending && demandRatio(overviewOf(activity.id)) < 2" class="sub-none">无积压</span>
              </div>
            </td>
            <td>
              <span v-if="activity.enrolled >= activity.capacity" class="badge badge-red">已满员</span>
              <span v-else class="badge badge-green">报名中</span>
              <span v-if="activity.reviewEnabled" class="badge badge-blue" style="margin-left:6px">需审核</span>
              <span v-if="activity.status === 'suspended'" class="badge badge-red" style="margin-left:6px">已被下架</span>
            </td>
            <td>
              <div class="row-actions">
                <button class="btn btn-ghost" style="padding:8px 12px" @click="props.onShowDetail(activity)">查看</button>
                <button class="btn btn-danger" style="padding:8px 12px" @click="onDelete(activity.id)">删除</button>
              </div>
            </td>
          </tr>
          <tr v-if="teacherActivities.length === 0">
            <td colspan="6" class="empty-cell">
              <div class="empty-state">
                <div class="icon">📝</div>
                <h3>还没有发布过活动</h3>
                <p>点击右上角按钮发布第一个活动</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="registrantsActivity" class="registrants-overlay" @click.self="closeRegistrants">
      <div class="registrants-modal card">
        <div class="registrants-head"><div><h2>报名名单</h2><p>{{ registrantsActivity.title }} · 正式 {{ registrantCounts.confirmed }} · 候补 {{ registrantCounts.waitlisted }} · 待审核 {{ registrantCounts.pending }}</p></div><button class="btn btn-ghost" @click="closeRegistrants">关闭</button></div>
        <div v-if="loadingRegistrants" class="registrants-empty">加载中...</div>
        <div v-else-if="registrants.length === 0" class="registrants-empty">暂无报名学生</div>
        <table v-else class="registrants-table">
          <thead><tr><th>姓名</th><th>账号</th><th>QQ 邮箱</th><th>报名时间</th><th>状态</th><th>审核</th></tr></thead>
          <tbody>
            <tr v-for="student in registrants" :key="`${student.id}-${student.registeredAt}`">
              <td>{{ student.name }}</td>
              <td>{{ student.account }}</td>
              <td>{{ student.email }}</td>
              <td>{{ formatDate(student.registeredAt) }}</td>
              <td>
                <span class="badge" :class="statusClass[student.status]">
                  {{ statusLabel[student.status] }}<template v-if="student.status === 'waitlisted' && student.position"> · 第 {{ student.position }} 位</template>
                </span>
              </td>
              <td>
                <div v-if="student.status === 'pending' && registrantsActivity.reviewEnabled" class="row-actions">
                  <button class="btn btn-ghost" style="padding:6px 10px" @click="review(student, 'approve')">通过</button>
                  <button class="btn btn-danger" style="padding:6px 10px" @click="review(student, 'reject')">未通过</button>
                </div>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
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
  margin-bottom: 32px;
  gap: 16px;
  flex-wrap: wrap;
}

.topbar h1 {
  font-size: 1.9rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.sub { color: var(--text-500); font-size: 0.95rem; }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.stat-card {
  padding: 24px;
}

.stat-card.alert { border-color: #f7c9c9; background: rgba(255,59,48,.04); }

.enroll-sub { margin-top: 6px; display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.76rem; font-weight: 600; }
.sub-wait { color: #1d6fd0; }
.sub-pending { color: #b26a00; }
.sub-applied { color: var(--text-500); }
.sub-hot { color: var(--error); }
.sub-none { color: var(--text-500); font-weight: 500; }
.topbar-actions { display: flex; gap: 10px; flex-wrap: wrap; }

.backlog-card { padding: 20px 22px; margin-bottom: 22px; border-color: #ffe0b2; background: rgba(255,149,0,.05); }
.backlog-head { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; }
.backlog-head strong { color: var(--text-800); }
.backlog-head small { color: var(--text-500); font-size: 0.78rem; }
.backlog-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.backlog-list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px dashed var(--bg-300); }
.backlog-list li:last-child { border-bottom: none; }
.backlog-title { color: var(--text-700); font-size: 0.9rem; font-weight: 600; }
.backlog-tags { display: flex; gap: 8px; flex: none; }
.backlog-tip { margin-top: 12px; color: var(--text-500); font-size: 0.8rem; line-height: 1.6; }

.stat-label {
  font-size: 0.85rem;
  color: var(--text-500);
  font-weight: 600;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--text-800);
}

.table-card {
  padding: 8px;
  overflow-x: auto;
}

.activity-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}

.activity-table th {
  text-align: left;
  padding: 16px;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-500);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--bg-200);
}

.activity-table td {
  padding: 16px;
  border-bottom: 1px solid var(--bg-200);
  color: var(--text-700);
}

.activity-table tbody tr:last-child td { border-bottom: none; }

.activity-name {
  display: flex;
  align-items: center;
  gap: 12px;
}

.activity-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--bg-200);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
}

.activity-name .title {
  font-weight: 700;
  color: var(--text-800);
  margin-bottom: 2px;
}

.activity-name .meta {
  font-size: 0.8rem;
  color: var(--text-500);
}

.row-actions {
  display: flex;
  gap: 8px;
}
.enrollment-link { border:0; background:transparent; color:var(--brand-600); font-weight:700; cursor:pointer; padding:0; font-size:.95rem; text-decoration:underline; text-underline-offset:3px; }
.registrants-overlay { position:fixed; inset:0; z-index:120; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(15,27,48,.48); backdrop-filter:blur(4px); }
.registrants-modal { width:min(760px,100%); max-height:80vh; overflow:auto; padding:26px; box-shadow:var(--shadow-2xl); }
.registrants-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:22px; }.registrants-head h2 { font-size:1.35rem; }.registrants-head p { margin-top:5px; color:var(--text-500); font-size:.86rem; }.registrants-empty { padding:50px 0; text-align:center; color:var(--text-500); }.registrants-table { width:100%; border-collapse:collapse; font-size:.9rem; }.registrants-table th,.registrants-table td { padding:13px 10px; text-align:left; border-bottom:1px solid var(--bg-200); }.registrants-table th { color:var(--text-500); font-size:.76rem; text-transform:uppercase; }

.empty-cell {
  padding: 60px 20px;
}

.empty-state {
  text-align: center;
  color: var(--text-500);
}

.empty-state .icon {
  width: 80px;
  height: 80px;
  margin: 0 auto 20px;
  border-radius: 50%;
  background: var(--bg-200);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.2rem;
}

.empty-state h3 { color: var(--text-800); font-size: 1.2rem; margin-bottom: 8px; }

@media (max-width: 980px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .activity-table { min-width: 760px; }
  .topbar-actions { width: 100%; }
  .topbar-actions .btn { flex: 1; }
}

@media (max-width: 640px) {
  .stats-grid { grid-template-columns: 1fr; }
  .activity-table th, .activity-table td { padding: 12px; }
  .backlog-list li { align-items: flex-start; flex-direction: column; }
}
</style>
