<script setup lang="ts">
import { computed } from 'vue'
import { useStore, categories, registrationLabels } from '../composables/useStore'
import { formatDateTimeShort, getMonthDay } from '../utils/format'
import type { Activity } from '../types'

const props = defineProps<{
  activity: Activity
  hideRegistered?: boolean
  conflict?: boolean
}>()

const emit = defineEmits<{
  click: [activity: Activity]
}>()

const { state, isTeacher, registrationOf } = useStore()
const cat = categories[props.activity.category]

const date = computed(() => getMonthDay(props.activity.time))
const timeLabel = computed(() => formatDateTimeShort(props.activity.time))
const deadlineLabel = computed(() => formatDateTimeShort(props.activity.deadline))
const isFull = computed(() => props.activity.enrolled >= props.activity.capacity)
const remaining = computed(() => Math.max(0, props.activity.capacity - props.activity.enrolled))
const waitlistCount = computed(() => props.activity.waitlistCount ?? 0)
const registration = computed(() => registrationOf(props.activity.id))
const statusLabel = computed(() => registration.value ? registrationLabels[registration.value.status] : '')
const registrationClass: Record<string, string> = {
  confirmed: 'badge-green',
  waitlisted: 'badge-blue',
  pending: 'badge-gray',
  rejected: 'badge-red'
}
const isMine = computed(() => isTeacher.value && props.activity.teacherId === state.currentUser?.id)
const isSuspended = computed(() => props.activity.status === 'suspended')
</script>

<template>
  <article class="card activity-card" @click="emit('click', activity)">
    <div class="cover">
      <div class="date-chip">{{ date.month }}月<br />{{ date.day }}日</div>
      <span>{{ activity.icon }}</span>
    </div>
    <div class="body">
      <div class="meta">
        <span class="badge" :class="`badge-${cat.color}`">{{ cat.label }}</span>
        <span v-if="isSuspended" class="badge badge-red">已被管理员下架</span>
        <span v-if="conflict" class="badge badge-red">时间冲突</span>
        <span v-if="isFull" class="badge badge-red">已满员</span>
        <span v-else-if="!registration" class="badge badge-gray">{{ activity.reviewEnabled ? '需审核' : '可报名' }}</span>
        <span v-if="waitlistCount > 0" class="badge badge-blue">候补 {{ waitlistCount }}</span>
        <span v-if="registration && !hideRegistered" class="badge" :class="registrationClass[registration.status]">
          {{ statusLabel }}<template v-if="registration.status === 'waitlisted' && registration.position"> · 第 {{ registration.position }} 位</template>
        </span>
        <span v-if="isMine" class="badge badge-gray">我发布</span>
      </div>
      <h3>{{ activity.title }}</h3>
      <p class="desc">{{ activity.desc }}</p>
      <div class="when-row">
        <span>🗓 {{ timeLabel }}</span>
        <span>截止 {{ deadlineLabel }}</span>
      </div>
      <div class="footer">
        <span class="spots">
          <span class="dot" :style="{ background: isFull ? 'var(--error)' : 'var(--success)' }"></span>
          {{ isFull ? '名额已满' : `剩余 ${remaining} 个名额` }} · {{ activity.enrolled }}/{{ activity.capacity }}
        </span>
        <span class="location">{{ activity.location }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.activity-card {
  display: flex;
  flex-direction: column;
  cursor: pointer;
}

.cover {
  height: 150px;
  background: linear-gradient(135deg, var(--bg-300) 0%, var(--bg-200) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 3rem;
  position: relative;
}

.date-chip {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(8px);
  color: var(--text-800);
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 0.78rem;
  font-weight: 700;
  text-align: center;
  line-height: 1.2;
  box-shadow: var(--shadow-xs);
}

.body { padding: 20px; flex: 1; display: flex; flex-direction: column; }

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

h3 {
  font-size: 1.12rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin-bottom: 8px;
  line-height: 1.3;
}

.desc {
  font-size: 0.88rem;
  color: var(--text-500);
  margin-bottom: 12px;
  line-height: 1.55;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.when-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: 0.78rem;
  color: var(--text-500);
  margin-bottom: 12px;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--bg-200);
}

.spots {
  font-size: 0.8rem;
  color: var(--text-500);
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.location {
  font-size: 0.8rem;
  color: var(--text-500);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .cover { height: 126px; font-size: 2.4rem; }
  .body { padding: 16px; }
  h3 { font-size: 1.05rem; }
}
</style>
