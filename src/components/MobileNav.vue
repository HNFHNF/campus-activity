<script setup lang="ts">
import { useStore } from '../composables/useStore'
import { useNavigation } from '../composables/useNavigation'
import { iconSvg } from '../utils/icons'

const { state, unreadCount, switchView, logout } = useStore()
const { navItems } = useNavigation()
</script>

<template>
  <nav class="mobile-nav" aria-label="主导航">
    <button
      v-for="item in navItems"
      :key="item.view"
      class="mobile-nav-item"
      :class="{ active: state.currentView === item.view }"
      @click="switchView(item.view)"
    >
      <span class="nav-icon-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="iconSvg(item.icon)" />
        <span v-if="item.view === 'notifications' && unreadCount > 0" class="mobile-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
      </span>
      <span class="nav-label">{{ item.short }}</span>
    </button>
    <button class="mobile-nav-item" @click="logout">
      <span class="nav-icon-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="iconSvg('logout')" />
      </span>
      <span class="nav-label">退出</span>
    </button>
  </nav>
</template>

<style scoped>
.mobile-nav {
  display: none;
}

@media (max-width: 980px) {
  .mobile-nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 90;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    align-items: stretch;
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
    background: rgba(255, 255, 255, 0.94);
    border-top: 1px solid var(--bg-300);
    backdrop-filter: blur(18px);
    box-shadow: 0 -8px 30px rgba(29, 48, 80, 0.08);
  }

  .mobile-nav-item {
    border: 0;
    background: transparent;
    color: var(--text-500);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 7px 4px;
    border-radius: 12px;
    font-family: inherit;
    font-size: 0.7rem;
    font-weight: 700;
    cursor: pointer;
    transition: color 0.18s ease, background 0.18s ease;
  }

  .mobile-nav-item.active {
    color: var(--brand-600);
    background: var(--brand-50);
  }

  .nav-icon-wrap { position: relative; display: inline-flex; }
  .mobile-nav-item svg { width: 22px; height: 22px; }
  .nav-label { line-height: 1; }

  .mobile-badge {
    position: absolute;
    top: -5px;
    right: -10px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 9999px;
    background: #ff3b30;
    color: #fff;
    font-size: 0.62rem;
    line-height: 16px;
    text-align: center;
  }
}
</style>
