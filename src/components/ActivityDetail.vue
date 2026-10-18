<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStore, categories, registrationLabels, CONFLICT_WINDOW_HOURS } from '../composables/useStore'
import { formatDate } from '../utils/format'
import type { Activity, ApplyResult } from '../types'

const props = defineProps<{
  activity: Activity | null
}>()

const emit = defineEmits<{
  close: []
  select: [activity: Activity]
}>()

const {
  state, isTeacher, isAdmin, registrationOf, apply, cancel, deleteActivity,
  alternativesFor, remainingSpots, isCancelling
} = useStore()

const submitting = ref(false)
const submitError = ref('')
const receipt = ref<ApplyResult | null>(null)

watch(() => props.activity?.id, () => {
  submitError.value = ''
  receipt.value = null
  submitting.value = false
})

const cat = computed(() => {
  if (!props.activity) return { label: '', color: 'gray' }
  return categories[props.activity.category]
})

const isFull = computed(() => props.activity ? props.activity.enrolled >= props.activity.capacity : false)
const remaining = computed(() => props.activity ? remainingSpots(props.activity) : 0)
const waitlistCount = computed(() => props.activity?.waitlistCount ?? 0)
const registration = computed(() => props.activity ? registrationOf(props.activity.id) : null)
const registrationClass: Record<string, string> = {
  confirmed: 'status-confirmed',
  waitlisted: 'status-waitlisted',
  pending: 'status-pending',
  rejected: 'status-rejected'
}
const statusHint = computed(() => {
  if (!registration.value) return ''
  if (registration.value.status === 'confirmed') return '你已正式报名，名额已为你保留。请留意活动开始时间；如无法参加请尽快取消，把名额让给候补同学。'
  if (registration.value.status === 'waitlisted') return `活动已满员，你在候补队列第 ${registration.value.position ?? '-'} 位；正式报名者取消后会按顺序自动递补，递补结果会进入通知中心。`
  if (registration.value.status === 'pending') return '报名申请已提交，等待活动组织教师审核；通过后按当时剩余名额转为正式或候补，结果会进入通知中心。'
  return '很抱歉，这次报名未通过审核。如果情况有变化，你可以在报名截止前重新提交申请。'
})
const statusBadgeClass = computed(() => {
  if (!registration.value) return 'badge-gray'
  if (registration.value.status === 'confirmed') return 'badge-green'
  if (registration.value.status === 'waitlisted') return 'badge-blue'
  if (registration.value.status === 'pending') return 'badge-gray'
  return 'badge-red'
})
const isMine = computed(() => {
  if (!isTeacher.value || !props.activity) return false
  return props.activity.teacherId === state.currentUser?.id
})

/** V3.0：满员或已有候补时推荐同类且仍有余量的活动 */
const alternatives = computed(() => props.activity ? alternativesFor(props.activity) : [])
const showAlternatives = computed(() => Boolean(props.activity) && (isFull.value || waitlistCount.value > 0))

const buttonLabel = computed(() => {
  if (submitting.value) return '正在提交…'
  if (!props.activity) return ''
  if (props.activity.reviewEnabled) return '提交报名申请'
  if (isFull.value) return waitlistCount.value > 0 ? `登记候补（第 ${waitlistCount.value + 1} 位）` : '登记候补'
  return '立即报名'
})

function resetReceipt() {
  submitError.value = ''
  receipt.value = null
}

async function onApply() {
  if (!props.activity || submitting.value) return
  resetReceipt()
  submitting.value = true
  try {
    const { result, error } = await apply(props.activity.id)
    if (result) receipt.value = result
    if (error) submitError.value = error
  } finally {
    submitting.value = false
  }
}

async function onCancel() {
  if (!props.activity) return
  const ok = await cancel(props.activity.id)
  if (ok) resetReceipt()
}

function onDelete() {
  if (!props.activity) return
  if (confirm('确定要删除这个活动吗？')) {
    deleteActivity(props.activity.id)
    emit('close')
  }
}

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}

function selectAlternative(activity: Activity) {
  resetReceipt()
  emit('select', activity)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.activity) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="modal-overlay" :class="{ open: activity }" @click="onOverlayClick">
    <div v-if="activity" class="modal" role="dialog" aria-modal="true" :aria-label="activity.title">
      <div class="modal-header">
        <span style="font-size:4rem">{{ activity.icon }}</span>
        <button class="modal-close" aria-label="关闭" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="meta-row">
          <span class="badge" :class="`badge-${cat.color}`">{{ cat.label }}</span>
          <span v-if="activity.status === 'suspended'" class="badge badge-red">已被管理员下架</span>
          <span v-if="activity.reviewEnabled" class="badge badge-blue">需组织教师审核</span>
          <span v-if="isFull" class="badge badge-red">名额已满</span>
          <span v-else class="badge badge-green">报名中</span>
          <span v-if="waitlistCount > 0" class="badge badge-blue">候补 {{ waitlistCount }} 人</span>
          <span v-if="registration" class="badge" :class="statusBadgeClass">
            {{ registrationLabels[registration.status] }}<template v-if="registration.status === 'waitlisted' && registration.position"> · 第 {{ registration.position }} 位</template>
          </span>
          <span v-if="isMine" class="badge badge-gray">我发布</span>
        </div>
        <h2>{{ activity.title }}</h2>
        <p class="desc">{{ activity.desc }}</p>
        <div class="info-grid">
          <div class="info-item"><div class="label-small">活动时间</div><div class="value">{{ formatDate(activity.time) }}</div></div>
          <div class="info-item"><div class="label-small">报名截止</div><div class="value">{{ formatDate(activity.deadline) }}</div></div>
          <div class="info-item"><div class="label-small">活动地点</div><div class="value">{{ activity.location }}</div></div>
          <div class="info-item"><div class="label-small">报名人数</div><div class="value">{{ activity.enrolled }} / {{ activity.capacity }}</div></div>
          <div class="info-item"><div class="label-small">主办方</div><div class="value">{{ activity.organizer }}</div></div>
          <div class="info-item"><div class="label-small">剩余名额</div><div class="value" :style="{ color: isFull ? 'var(--error)' : 'var(--success)' }">{{ isFull ? 0 : remaining }}</div></div>
        </div>

        <div v-if="registration" class="status-panel" :class="registrationClass[registration.status]">
          <strong>
            {{ registrationLabels[registration.status] }}<template v-if="registration.status === 'waitlisted' && registration.position"> · 候补第 {{ registration.position }} 位</template>
          </strong>
          <p>{{ statusHint }}</p>
          <div class="status-meta">状态更新：{{ formatDate(registration.statusUpdatedAt) }}</div>
        </div>
        <div v-else-if="activity.status === 'suspended'" class="status-panel status-rejected">
          <strong>活动已被管理员下架</strong>
          <p>{{ activity.suspendedReason || '该活动因违规被下架，暂时不能报名。' }}</p>
        </div>

        <div v-if="receipt" class="receipt-panel">
          <div class="receipt-head">
            <strong>{{ receipt.reused ? '已确认报名状态' : '提交成功' }}</strong>
            <span class="badge" :class="statusBadgeClass">{{ registrationLabels[receipt.status] }}</span>
          </div>
          <p v-if="receipt.reused">服务端已识别到你对这个活动已有报名记录，本次没有重复创建。当前状态：{{ registrationLabels[receipt.status] }}。</p>
          <p v-else>报名回执已生成，状态变化会进入通知中心，不需要留在本页反复刷新。</p>
          <div class="receipt-code">
            回执编号 <code>{{ (receipt.requestId || '—').slice(0, 8) }}</code>
            <template v-if="receipt.requestId"> · 提交时间 {{ formatDate(receipt.statusUpdatedAt) }}</template>
          </div>
        </div>

        <div v-if="submitError" class="error-panel" role="alert">
          <strong>本次提交未完成</strong>
          <p>{{ submitError }}</p>
          <p class="error-tip">可以检查网络后重试；同一个报名请求会复用回执编号，不会重复占位。</p>
        </div>

        <div v-if="showAlternatives && alternatives.length > 0" class="alternatives">
          <div class="alternatives-head">
            <strong>同类活动还有余量</strong>
            <span>依据报名数据：热门活动候补集中，建议同时考虑下列活动</span>
          </div>
          <ul>
            <li v-for="item in alternatives" :key="item.id" @click="selectAlternative(item)">
              <span class="alt-icon">{{ item.icon }}</span>
              <span class="alt-main">
                <strong>{{ item.title }}</strong>
                <small>{{ formatDate(item.time) }} · {{ item.location }}</small>
              </span>
              <span class="alt-spots">余 {{ remainingSpots(item) }} 个</span>
            </li>
          </ul>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" @click="emit('close')">关闭</button>
          <template v-if="isTeacher">
            <button v-if="isMine" class="btn btn-danger" @click="onDelete">删除活动</button>
          </template>
          <template v-else-if="!isAdmin">
            <button
              v-if="!registration"
              class="btn btn-primary"
              :disabled="activity.status === 'suspended' || submitting"
              @click="onApply"
            >
              {{ buttonLabel }}
            </button>
            <button
              v-else-if="registration.status === 'rejected'"
              class="btn btn-primary"
              :disabled="submitting"
              @click="onApply"
            >
              {{ submitting ? '正在提交…' : '重新申请' }}
            </button>
            <button v-else class="btn btn-danger" :disabled="isCancelling(activity.id)" @click="onCancel">
              {{ isCancelling(activity.id) ? '处理中…' : (registration.status === 'confirmed' ? '取消报名' : registration.status === 'waitlisted' ? '退出候补' : '撤回申请') }}
            </button>
          </template>
        </div>
        <p class="conflict-note">
          V3.0 提示：已报名活动之间开始时间相差不足 {{ CONFLICT_WINDOW_HOURS }} 小时会在“我的活动”汇总提醒，报名成功后也会检查一次。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
}

.modal-overlay.open { opacity: 1; pointer-events: auto; }

.modal {
  background: var(--bg-50);
  border-radius: calc(var(--radius) + 6px);
  width: 100%;
  max-width: 680px;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: var(--shadow-2xl);
  transform: scale(0.96);
  transition: transform 0.25s ease;
}

.modal-overlay.open .modal { transform: scale(1); }

.modal-header {
  position: relative;
  height: 180px;
  background: linear-gradient(135deg, var(--bg-300) 0%, var(--bg-200) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255,255,255,0.9);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-800);
  transition: background 0.2s ease;
}

.modal-close:hover { background: #fff; }

.modal-body { padding: 28px; overflow-y: auto; max-height: calc(90vh - 180px); }

.meta-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.modal-body h2 {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 10px;
  line-height: 1.25;
}

.desc {
  color: var(--text-500);
  line-height: 1.65;
  font-size: 0.94rem;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin: 20px 0;
}

.info-item {
  background: var(--bg-100);
  border-radius: 0.9rem;
  padding: 14px;
}

.label-small {
  font-size: 0.76rem;
  color: var(--text-500);
  font-weight: 600;
  margin-bottom: 4px;
}

.value { font-weight: 700; color: var(--text-800); font-size: 0.92rem; }

.status-panel {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface-2, rgba(0,0,0,0.02));
}

.status-panel strong { display: block; margin-bottom: 4px; font-size: 0.95rem; }
.status-panel p { margin: 0; font-size: 0.85rem; line-height: 1.6; color: var(--text-muted, #667085); }
.status-meta { margin-top: 8px; color: var(--text-500); font-size: 0.76rem; }

.status-confirmed { border-color: var(--success); background: rgba(34, 197, 94, 0.08); }
.status-waitlisted { border-color: #3b82f6; background: rgba(59, 130, 246, 0.08); }
.status-pending { border-color: #94a3b8; background: rgba(148, 163, 184, 0.12); }
.status-rejected { border-color: var(--error); background: rgba(239, 68, 68, 0.08); }

.receipt-panel {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(52, 199, 89, 0.4);
  background: rgba(52, 199, 89, 0.07);
}

.receipt-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.receipt-panel p { margin: 0 0 6px; color: var(--text-600); font-size: 0.85rem; line-height: 1.6; }
.receipt-code { color: var(--text-500); font-size: 0.78rem; }
.receipt-code code { background: var(--bg-200); padding: 2px 6px; border-radius: 6px; color: var(--text-800); }

.error-panel {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 59, 48, 0.35);
  background: rgba(255, 59, 48, 0.06);
}
.error-panel strong { color: var(--error); font-size: 0.92rem; }
.error-panel p { margin: 4px 0 0; color: var(--text-600); font-size: 0.85rem; line-height: 1.6; }
.error-tip { color: var(--text-500) !important; font-size: 0.78rem !important; }

.alternatives {
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px dashed var(--bg-400);
  background: var(--bg-100);
}
.alternatives-head strong { display: block; font-size: 0.92rem; color: var(--text-800); }
.alternatives-head span { display: block; margin-top: 3px; font-size: 0.76rem; color: var(--text-500); }
.alternatives ul { list-style: none; margin: 10px 0 0; display: flex; flex-direction: column; gap: 8px; }
.alternatives li { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; background: var(--bg-50); cursor: pointer; }
.alternatives li:hover { background: var(--brand-50); }
.alt-icon { font-size: 1.2rem; }
.alt-main { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.alt-main strong { font-size: 0.86rem; color: var(--text-800); }
.alt-main small { color: var(--text-500); font-size: 0.74rem; margin-top: 2px; }
.alt-spots { color: var(--success); font-size: 0.78rem; font-weight: 700; white-space: nowrap; }

.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 22px;
  flex-wrap: wrap;
}

.conflict-note { margin-top: 12px; color: var(--text-500); font-size: 0.75rem; line-height: 1.5; }

@media (max-width: 640px) {
  .modal-overlay { padding: 0; align-items: stretch; }
  .modal { max-width: none; max-height: 100vh; border-radius: 0; }
  .modal-header { height: 150px; }
  .modal-body { max-height: calc(100vh - 150px); padding: 20px 18px calc(96px + env(safe-area-inset-bottom)); }
  .info-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
  .modal-body h2 { font-size: 1.4rem; }
  .modal-actions { position: sticky; bottom: 0; background: var(--bg-50); padding-top: 12px; }
}
</style>
