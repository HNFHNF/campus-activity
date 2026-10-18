<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useStore } from '../composables/useStore'
import { formatDate } from '../utils/format'
import type { Activity } from '../types'

const { state, loadActivities, suspendActivity, restoreActivity, showToast } = useStore()

const search = ref('')
const loading = ref(true)
const filter = ref<'all' | 'suspended'>('all')
const suspendTarget = ref<Activity | null>(null)
const suspendReason = ref('')
const submitting = ref(false)

const suspendedCount = computed(() => state.activities.filter(activity => activity.status === 'suspended').length)

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return [...state.activities]
    .sort((a, b) => Number(b.status === 'suspended') - Number(a.status === 'suspended') || b.id - a.id)
    .filter(activity => {
      if (filter.value === 'suspended' && activity.status !== 'suspended') return false
      if (!query) return true
      return `${activity.title} ${activity.organizer} ${activity.teacherId ?? ''}`.toLowerCase().includes(query)
    })
})

onMounted(async () => {
  await refresh()
})

async function refresh() {
  loading.value = true
  try {
    await loadActivities()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '活动列表加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

function openSuspend(activity: Activity) {
  suspendTarget.value = activity
  suspendReason.value = ''
}

function closeSuspend() {
  if (submitting.value) return
  suspendTarget.value = null
  suspendReason.value = ''
}

async function confirmSuspend() {
  const activity = suspendTarget.value
  if (!activity) return
  const reason = suspendReason.value.trim()
  if (!reason) {
    showToast('请填写下架原因')
    return
  }
  submitting.value = true
  try {
    await suspendActivity(activity.id, reason)
    suspendTarget.value = null
    suspendReason.value = ''
  } catch (error) {
    showToast(error instanceof Error ? error.message : '下架失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

async function restore(activity: Activity) {
  try {
    await restoreActivity(activity.id)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '恢复失败，请稍后重试')
  }
}
</script>

<template>
  <section class="view governance-view">
    <div class="page-heading">
      <div>
        <div class="eyebrow">ADMINISTRATION · GOVERNANCE</div>
        <h1>违规活动治理</h1>
        <p class="sub">下架违规活动：下架后学生端不可见、不可报名，组织教师仍可查看和修改内容</p>
      </div>
      <button class="btn btn-secondary refresh-btn" @click="refresh">↻ 刷新列表</button>
    </div>

    <div class="summary-grid">
      <div class="summary-card card">
        <span class="summary-icon blue">📋</span>
        <div>
          <span class="summary-label">活动总数</span>
          <strong>{{ state.activities.length }}</strong>
        </div>
      </div>
      <div class="summary-card card" :class="{ alert: suspendedCount > 0 }">
        <span class="summary-icon red">⚠</span>
        <div>
          <span class="summary-label">已下架活动</span>
          <strong>{{ suspendedCount }}</strong>
        </div>
      </div>
    </div>

    <div class="toolbar card">
      <div class="toolbar-title">
        <span class="dot"></span>
        <span>活动列表</span>
        <small>{{ filtered.length }} 条记录</small>
      </div>
      <div class="toolbar-tools">
        <div class="filter-group">
          <button class="chip" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
          <button class="chip" :class="{ active: filter === 'suspended' }" @click="filter = 'suspended'">仅看已下架</button>
        </div>
        <input v-model="search" class="input search-input" placeholder="搜索活动名称、主办方或组织教师" />
      </div>
    </div>

    <div class="table-card card">
      <table class="governance-table">
        <colgroup>
          <col style="width:34%" />
          <col style="width:11%" />
          <col style="width:16%" />
          <col style="width:11%" />
          <col style="width:14%" />
          <col style="width:14%" />
        </colgroup>
        <thead>
          <tr>
            <th>活动</th>
            <th>组织教师</th>
            <th>活动时间</th>
            <th>报名情况</th>
            <th>状态</th>
            <th class="actions-col">治理操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="activity in filtered" :key="activity.id">
            <td>
              <div class="activity-cell">
                <span class="activity-icon">{{ activity.icon }}</span>
                <div class="activity-text">
                  <div class="title">{{ activity.title }}</div>
                  <div class="meta">{{ activity.organizer }}</div>
                </div>
              </div>
            </td>
            <td class="muted">{{ activity.teacherId }}</td>
            <td class="muted">{{ formatDate(activity.time) }}</td>
            <td class="muted">{{ activity.enrolled }} / {{ activity.capacity }}</td>
            <td>
              <span v-if="activity.status === 'suspended'" class="badge badge-red">已下架</span>
              <span v-else class="badge badge-green">正常</span>
              <div v-if="activity.suspendedReason" class="reason-text" :title="activity.suspendedReason">
                {{ activity.suspendedReason }}
              </div>
            </td>
            <td class="actions-col">
              <div class="row-actions">
                <button v-if="activity.status === 'suspended'" class="btn btn-secondary" @click="restore(activity)">恢复</button>
                <button v-else class="btn btn-danger" @click="openSuspend(activity)">下架</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && filtered.length === 0">
            <td colspan="6" class="empty-cell">
              <div class="empty-state">
                <div class="icon">{{ filter === 'suspended' ? '✅' : '🔍' }}</div>
                <h3>{{ filter === 'suspended' ? '当前没有已下架的活动' : '没有匹配的活动' }}</h3>
                <p>{{ filter === 'suspended' ? '所有活动都处于正常状态' : '换个关键词试试' }}</p>
              </div>
            </td>
          </tr>
          <tr v-if="loading">
            <td colspan="6" class="empty-cell">加载中...</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="suspendTarget" class="reason-overlay" @click.self="closeSuspend">
      <div class="reason-modal card">
        <h2>下架活动</h2>
        <p class="reason-target">{{ suspendTarget.icon }} {{ suspendTarget.title }}</p>
        <label class="label">下架原因（会展示给已报名的学生）</label>
        <textarea
          v-model="suspendReason"
          class="input reason-input"
          rows="3"
          placeholder="例如：活动内容与校园活动无关"
        ></textarea>
        <div class="reason-actions">
          <button class="btn btn-secondary" :disabled="submitting" @click="closeSuspend">取消</button>
          <button class="btn btn-danger" :disabled="submitting" @click="confirmSuspend">
            {{ submitting ? '处理中…' : '确认下架' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:26px; }
.eyebrow { color:var(--brand-500); font-size:.72rem; letter-spacing:.14em; font-weight:800; margin-bottom:8px; }
.page-heading h1 { font-size:2.15rem; font-weight:750; letter-spacing:-.04em; }
.sub { color:var(--text-500); font-size:.95rem; margin-top:4px; }
.refresh-btn { padding:11px 16px; }

.summary-grid { display:grid; grid-template-columns:repeat(2,minmax(0,240px)); gap:16px; margin-bottom:22px; }
.summary-card { display:flex; align-items:center; gap:14px; padding:19px 22px; border:1px solid var(--bg-200); box-shadow:0 8px 24px rgba(29,48,80,.05); }
.summary-card.alert { border-color:#f7c9c9; }
.summary-icon { width:42px; height:42px; display:grid; place-items:center; border-radius:13px; font-size:1.15rem; }
.summary-icon.blue { background:#e9f3ff; color:#1971d4; }
.summary-icon.red { background:#fdeaea; color:#c0392b; }
.summary-label { display:block; color:var(--text-500); font-size:.78rem; margin-bottom:3px; }
.summary-card strong { font-size:1.45rem; letter-spacing:-.03em; }

.toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 18px; margin-bottom:14px; border:1px solid var(--bg-200); }
.toolbar-title { display:flex; align-items:center; gap:9px; font-weight:750; color:var(--text-800); }
.toolbar-title small { color:var(--text-500); font-size:.78rem; font-weight:500; margin-left:3px; }
.dot { width:8px; height:8px; background:var(--brand-500); border-radius:50%; box-shadow:0 0 0 4px var(--brand-50); }
.toolbar-tools { display:flex; align-items:center; gap:14px; }
.filter-group { display:flex; gap:8px; }
.chip { padding:7px 14px; border-radius:999px; border:1px solid var(--bg-300); background:var(--bg-50); color:var(--text-600); font-size:.82rem; font-weight:600; cursor:pointer; transition:all .16s ease; }
.chip:hover { border-color:var(--brand-300); color:var(--brand-600); }
.chip.active { background:var(--brand-500); border-color:var(--brand-500); color:#fff; }
.search-input { width:280px; height:40px; }

.table-card { padding:0; overflow:hidden; box-shadow:0 10px 28px rgba(29,48,80,.06); }
.governance-table { width:100%; table-layout:fixed; border-collapse:separate; border-spacing:0; font-size:.92rem; }
.governance-table th,
.governance-table td { padding:16px 18px; text-align:left; border-bottom:1px solid var(--bg-200); vertical-align:middle; }
.governance-table th { color:var(--text-500); background:var(--bg-100); font-size:.75rem; text-transform:uppercase; letter-spacing:.07em; font-weight:700; }
.governance-table tbody tr { transition:background .18s ease; }
.governance-table tbody tr:hover { background:var(--bg-50); }
.governance-table tbody tr:last-child td { border-bottom:none; }

.activity-cell { display:flex; align-items:center; gap:12px; min-width:0; }
.activity-icon { width:38px; height:38px; display:grid; place-items:center; border-radius:11px; background:var(--bg-100); font-size:1.1rem; flex:none; }
.activity-text { min-width:0; }
.activity-text .title { font-weight:700; color:var(--text-800); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.activity-text .meta { margin-top:3px; color:var(--text-500); font-size:.78rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.muted { color:var(--text-600); }
.reason-text { margin-top:6px; color:var(--text-500); font-size:.75rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.actions-col { text-align:right; }
.actions-col .row-actions { display:flex; gap:8px; justify-content:flex-end; }
.row-actions .btn { padding:7px 12px; font-size:.82rem; }
.empty-cell { text-align:center !important; color:var(--text-500); padding:56px 16px !important; }

.reason-overlay { position:fixed; inset:0; background:rgba(15,23,42,.45); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; z-index:60; }
.reason-modal { width:min(460px,92vw); padding:26px 26px 22px; box-shadow:0 24px 60px rgba(15,23,42,.24); }
.reason-modal h2 { font-size:1.2rem; margin-bottom:6px; }
.reason-target { color:var(--text-600); font-size:.9rem; margin-bottom:18px; }
.reason-modal .label { display:block; margin-bottom:8px; font-size:.82rem; color:var(--text-600); }
.reason-input { width:100%; resize:vertical; font-family:inherit; line-height:1.6; }
.reason-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; }

@media (max-width:900px) {
  .page-heading { align-items:stretch; flex-direction:column; }
  .summary-grid { grid-template-columns:1fr; }
  .toolbar { align-items:stretch; flex-direction:column; }
  .toolbar-tools { flex-direction:column; align-items:stretch; }
  .search-input { width:100%; }
  .governance-table { table-layout:auto; }
  .governance-table th:first-child, .governance-table td:first-child { min-width:220px; }
}
</style>
