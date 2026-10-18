<script setup lang="ts">
import { useStore } from '../composables/useStore'
import { useNavigation } from '../composables/useNavigation'
import { iconSvg } from '../utils/icons'

const { state, unreadCount, logout, switchView } = useStore()
const { navItems } = useNavigation()

function roleLabel() {
  if (state.currentUser?.role === 'teacher') return '组织教师'
  if (state.currentUser?.role === 'admin') return '管理员'
  return '学生'
}
</script>

<template>
  <aside class="sidebar">
    <div class="logo">
      <div class="logo-mark">C</div>
      <div class="logo-text">
        <span>CampusEvents</span>
        <small>V3.0</small>
      </div>
    </div>
    <nav>
      <ul class="nav-list">
        <li
          v-for="item in navItems"
          :key="item.view"
          class="nav-item"
          :class="{ active: state.currentView === item.view }"
          @click="switchView(item.view)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="iconSvg(item.icon)" />
          {{ item.label }}
          <span v-if="item.view === 'notifications' && unreadCount > 0" class="nav-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
        </li>
      </ul>
    </nav>
    <div class="sidebar-footer">
      <div class="user-mini">
        <div class="user-avatar">{{ state.currentUser?.avatar }}</div>
        <div class="user-meta">
          <div class="name">{{ state.currentUser?.name }}</div>
          <div class="role">{{ roleLabel() }}</div>
        </div>
      </div>
      <button class="btn btn-ghost logout-btn" @click="logout">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        退出登录
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  background: var(--bg-50);
  border-right: 1px solid var(--bg-300);
  padding: 32px 20px;
  display: flex;
  flex-direction: column;
  z-index: 50;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: 40px;
  padding: 0 12px;
}

.logo-mark {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--brand-500);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.logo-text { display: flex; flex-direction: column; line-height: 1.15; }
.logo-text small { color: var(--brand-600); font-size: 0.68rem; letter-spacing: 0.12em; font-weight: 800; }

.nav-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 0.9rem;
  color: var(--text-600);
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.nav-item:hover { background: var(--bg-200); color: var(--text-800); }

.nav-item.active {
  background: var(--brand-500);
  color: #fff;
  box-shadow: 0 4px 14px rgba(0, 122, 255, 0.28);
}

.nav-item svg { width: 20px; height: 20px; flex-shrink: 0; }

.nav-badge {
  margin-left: auto;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 9999px;
  background: #ff3b30;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.nav-item.active .nav-badge { background: #fff; color: var(--brand-600); }

.sidebar-footer {
  padding: 16px 12px 0;
  border-top: 1px solid var(--bg-300);
}

.user-mini {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--brand-500);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}

.user-meta { min-width: 0; }
.user-meta .name { font-weight: 700; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-meta .role { font-size: 0.78rem; color: var(--text-500); }

.logout-btn { width: 100%; margin-top: 12px; justify-content: flex-start; }

@media (max-width: 980px) {
  .sidebar { display: none; }
}
</style>
