<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStore } from './composables/useStore'
import AuthScreen from './components/AuthScreen.vue'
import Sidebar from './components/Sidebar.vue'
import DiscoverView from './components/DiscoverView.vue'
import MyActivitiesView from './components/MyActivitiesView.vue'
import PublishView from './components/PublishView.vue'
import ManageView from './components/ManageView.vue'
import StudentManageView from './components/StudentManageView.vue'
import GovernanceView from './components/GovernanceView.vue'
import NotificationsView from './components/NotificationsView.vue'
import MobileNav from './components/MobileNav.vue'
import ActivityDetail from './components/ActivityDetail.vue'
import type { Activity } from './types'

const { state, isLoggedIn, toast } = useStore()
const selectedActivityId = ref<number | null>(null)
// 从全局列表里按 id 取当前活动，报名后人数/候补数刷新时详情页能同步更新
const selectedActivity = computed(() => {
  if (selectedActivityId.value === null) return null
  return state.activities.find(activity => activity.id === selectedActivityId.value) ?? null
})

function showDetail(activity: Activity) {
  selectedActivityId.value = activity.id
}

function closeDetail() {
  selectedActivityId.value = null
}
</script>

<template>
  <AuthScreen v-if="!isLoggedIn" />
  <div v-else class="app-shell">
    <Sidebar />
    <main class="main-content">
      <DiscoverView v-if="state.currentView === 'discover'" :on-show-detail="showDetail" />
      <MyActivitiesView v-else-if="state.currentView === 'myActivities'" :on-show-detail="showDetail" />
      <PublishView v-else-if="state.currentView === 'publish'" />
      <ManageView v-else-if="state.currentView === 'manage'" :on-show-detail="showDetail" />
      <StudentManageView v-else-if="state.currentView === 'accounts'" />
      <GovernanceView v-else-if="state.currentView === 'governance'" />
      <NotificationsView v-else-if="state.currentView === 'notifications'" />
    </main>
    <MobileNav />
    <ActivityDetail :activity="selectedActivity" @close="closeDetail" @select="showDetail" />
  </div>
  <div class="toast" :class="{ show: toast }">{{ toast }}</div>
</template>
