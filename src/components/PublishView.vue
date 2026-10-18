<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useStore, categories } from '../composables/useStore'
import type { ActivityCategory } from '../types'

const { state, publishActivity, updateActivity, switchView, showToast, cancelEditActivity } = useStore()
const editingActivity = computed(() => state.editingActivity)

const categoryList = (Object.entries(categories) as Array<[ActivityCategory, { label: string }]>)
  .map(([key, value]) => ({ key, label: value.label }))

const nowLocal = (() => {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
})()

const title = ref('')
const category = ref<ActivityCategory>('academic')
const desc = ref('')
const time = ref('')
const deadline = ref('')
const location = ref('')
const capacity = ref(50)
const organizer = ref(state.currentUser?.name ? `${state.currentUser.name} 组织` : '校团委')
const icon = ref('🎯')
const reviewEnabled = ref(false)
const submitting = ref(false)

watch(editingActivity, (activity) => {
  if (!activity) return
  title.value = activity.title
  category.value = activity.category
  desc.value = activity.desc
  time.value = activity.time.replace(' ', 'T')
  deadline.value = activity.deadline.replace(' ', 'T')
  location.value = activity.location
  capacity.value = activity.capacity
  organizer.value = activity.organizer
  icon.value = activity.icon
  reviewEnabled.value = activity.reviewEnabled
}, { immediate: true })

const iconOptions = ['🎯', '🎓', '🎤', '🏃', '🏮', '🤝', '📷', '🤖', '🎸', '🏀', '🎨', '📚']

function resetForm() {
  title.value = ''
  desc.value = ''
  time.value = ''
  deadline.value = ''
  location.value = ''
  capacity.value = 50
  organizer.value = state.currentUser?.name ? `${state.currentUser.name} 组织` : '校团委'
  icon.value = '🎯'
  reviewEnabled.value = false
}

async function submit() {
  if (submitting.value) return
  if (!title.value.trim() || !desc.value.trim() || !time.value || !location.value.trim()) {
    showToast('请填写完整活动信息')
    return
  }
  if (!deadline.value) {
    showToast('请填写报名截止时间')
    return
  }
  if (deadline.value > time.value) {
    showToast('报名截止时间不能晚于活动开始时间')
    return
  }
  submitting.value = true
  try {
    const payload = {
      title: title.value.trim(),
      category: category.value,
      desc: desc.value.trim(),
      time: time.value,
      deadline: deadline.value,
      location: location.value.trim(),
      capacity: Math.max(1, Math.floor(capacity.value) || 1),
      organizer: organizer.value.trim(),
      icon: icon.value,
      reviewEnabled: reviewEnabled.value,
      teacherId: state.currentUser!.id
    }
    if (editingActivity.value) await updateActivity({ ...editingActivity.value, ...payload })
    else await publishActivity(payload)
  } catch (error) {
    showToast(error instanceof Error ? error.message : (editingActivity.value ? '保存失败，请稍后重试' : '发布失败，请稍后重试'))
    return
  } finally {
    submitting.value = false
  }
  resetForm()
  cancelEditActivity()
  switchView('manage')
}
</script>

<template>
  <section class="view">
    <div class="topbar">
      <div>
        <h1>{{ editingActivity ? '编辑活动' : '发布活动' }}</h1>
        <p class="sub">{{ editingActivity ? '修改活动信息，更新后学生端会立即同步' : '填写信息，为学生创建一个新活动' }}</p>
      </div>
    </div>

    <form class="publish-card card" @submit.prevent="submit">
      <div class="form-grid">
        <div class="form-group wide">
          <label class="label">活动标题</label>
          <input type="text" class="input" v-model="title" placeholder="例如：秋季校园摄影大赛" required />
        </div>

        <div class="form-group">
          <label class="label">活动类别</label>
          <select class="input" v-model="category">
            <option v-for="cat in categoryList" :key="cat.key" :value="cat.key">{{ cat.label }}</option>
          </select>
        </div>

        <div class="form-group">
          <label class="label">活动图标</label>
          <div class="icon-picker">
            <button
              type="button"
              v-for="ic in iconOptions"
              :key="ic"
              class="icon-btn"
              :class="{ active: icon === ic }"
              @click="icon = ic"
            >{{ ic }}</button>
          </div>
        </div>

        <div class="form-group">
          <label class="label">活动时间</label>
          <input type="datetime-local" class="input" v-model="time" :min="nowLocal" required />
        </div>

        <div class="form-group">
          <label class="label">报名截止</label>
          <input type="datetime-local" class="input" v-model="deadline" :min="nowLocal" required />
        </div>

        <div class="form-group">
          <label class="label">活动地点</label>
          <input type="text" class="input" v-model="location" placeholder="例如：图书馆报告厅" required />
        </div>

        <div class="form-group">
          <label class="label">人数上限</label>
          <input type="number" class="input" v-model.number="capacity" min="1" required />
        </div>

        <div class="form-group">
          <label class="label">主办方</label>
          <input type="text" class="input" v-model="organizer" placeholder="主办方名称" required />
        </div>

        <div class="form-group wide">
          <label class="label">活动介绍</label>
          <textarea class="input textarea" v-model="desc" rows="5" placeholder="介绍活动内容、流程、注意事项..." required></textarea>
        </div>

        <div class="form-group wide">
          <label class="label">报名审核</label>
          <label class="switch-row">
            <input type="checkbox" v-model="reviewEnabled" />
            <span>开启报名审核：学生报名后先进入待审核，由你决定通过或未通过；通过时按当时的剩余名额转为正式或候补。不开启时有名额直接正式、满员自动进入候补队列。</span>
          </label>
        </div>
      </div>

      <div class="actions">
        <button type="button" class="btn btn-secondary" :disabled="submitting" @click="cancelEditActivity(); switchView('manage')">取消</button>
        <button type="submit" class="btn btn-primary" :disabled="submitting">{{ submitting ? '保存中…' : (editingActivity ? '保存修改' : '发布活动') }}</button>
      </div>
    </form>
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
}

.topbar h1 {
  font-size: 1.9rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.sub { color: var(--text-500); font-size: 0.95rem; }

.publish-card {
  max-width: 800px;
  padding: 36px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

.form-group.wide {
  grid-column: 1 / -1;
}

.textarea {
  resize: vertical;
  min-height: 120px;
}

.icon-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.icon-btn {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  border: 1px solid var(--bg-400);
  background: var(--bg-50);
  font-size: 1.25rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-btn:hover { border-color: var(--brand-300); }
.icon-btn.active { border-color: var(--brand-500); background: var(--brand-50); }

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--bg-200);
}

@media (max-width: 640px) {
  .form-grid { grid-template-columns: 1fr; }
  .publish-card { padding: 24px; }
}
.switch-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--text-muted, #667085);
}

.switch-row input {
  margin-top: 3px;
  width: 16px;
  height: 16px;
  flex: none;
}
</style>
