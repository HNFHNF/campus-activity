<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { StudentRecord } from '../types'
import { formatDate } from '../utils/format'
import { useStore } from '../composables/useStore'
import { invoke } from '../services/bridge'

const { showToast, isAdmin } = useStore()
const students = ref<StudentRecord[]>([])
const selected = ref<StudentRecord | null>(null)
const name = ref('')
const email = ref('')
const newPassword = ref('')
const search = ref('')
const loading = ref(true)

const filteredStudents = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return students.value
  return students.value.filter(student => `${student.account} ${student.name} ${student.email}`.toLowerCase().includes(query))
})

const activeCount = computed(() => students.value.filter(student => student.status !== 'disabled').length)
const disabledCount = computed(() => students.value.filter(student => student.status === 'disabled').length)
const qqCount = computed(() => students.value.filter(student => student.email.endsWith('@qq.com')).length)

async function loadStudents() {
  loading.value = true
  try {
    const result = await invoke<StudentRecord[]>('students:list')
    students.value = Array.isArray(result) ? result : []
  } catch {
    showToast('学生数据加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

function editStudent(student: StudentRecord) {
  selected.value = student
  name.value = student.name
  email.value = student.email
  newPassword.value = ''
}

function closeEditor() {
  selected.value = null
  newPassword.value = ''
}

async function saveStudent() {
  if (!selected.value) return
  try {
    const result = await invoke<{ name: string; email: string }>('students:update', { id: selected.value.id, name: name.value, email: email.value })
    Object.assign(selected.value, result)
    const item = students.value.find(student => student.id === selected.value?.id)
    if (item) Object.assign(item, result)
    showToast('学生资料已更新')
    if (newPassword.value) {
      await invoke('students:reset-password', { id: selected.value.id, password: newPassword.value })
      showToast('学生资料和密码已更新')
    }
    closeEditor()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败，请稍后重试')
  }
}

async function deleteStudent(student: StudentRecord) {
  if (!confirm(`确定删除学生账号“${student.account}”吗？此操作不可撤销。`)) return
  try {
    await invoke('students:delete', student.id)
    students.value = students.value.filter(item => item.id !== student.id)
    if (selected.value?.id === student.id) closeEditor()
    showToast('学生账号已删除')
  } catch {
    showToast('删除失败，请稍后重试')
  }
}

async function toggleStatus(student: StudentRecord) {
  const next = student.status === 'disabled' ? 'active' : 'disabled'
  if (next === 'disabled' && !confirm(`确定停用账号“${student.account}”吗？停用后该学生无法登录和报名。`)) return
  try {
    await invoke('admin:set-account-status', { account: student.account, status: next })
    student.status = next
    showToast(next === 'disabled' ? '账号已停用' : '账号已启用')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败，请稍后重试')
  }
}

onMounted(loadStudents)
</script>

<template>
  <section class="view student-view">
    <div class="page-heading">
      <div>
        <div class="eyebrow">ADMINISTRATION · ACCOUNTS</div>
        <h1>账号管理</h1>
        <p class="sub">负责学生账号的启停与登录凭据维护</p>
      </div>
      <button class="btn btn-secondary refresh-btn" @click="loadStudents">↻ 刷新列表</button>
    </div>

    <div class="summary-grid">
      <div class="summary-card card"><span class="summary-icon blue">👥</span><div><span class="summary-label">启用中的账号</span><strong>{{ activeCount }}</strong></div></div>
      <div class="summary-card card"><span class="summary-icon green">✉</span><div><span class="summary-label">已绑定 QQ 邮箱</span><strong>{{ qqCount }}</strong></div></div>
      <div class="summary-card card"><span class="summary-icon purple">⏸</span><div><span class="summary-label">已停用账号</span><strong>{{ disabledCount }}</strong></div></div>
    </div>

    <div class="toolbar card">
      <div class="toolbar-title"><span class="dot"></span><span>学生账号列表</span><small>{{ filteredStudents.length }} 条记录</small></div>
      <input v-model="search" class="input search-input" placeholder="搜索账号、姓名或邮箱" />
    </div>

    <div class="student-layout">
      <div class="table-card card">
        <table class="student-table">
          <thead><tr><th>学生</th><th>账号</th><th>QQ 邮箱</th><th>注册时间</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="student in filteredStudents" :key="student.id">
              <td><div class="student-profile"><span class="student-avatar">{{ student.name.charAt(0).toUpperCase() }}</span><div><strong>{{ student.name }}</strong><small>学生账号</small></div></div></td>
              <td class="account">{{ student.account }}</td>
              <td>{{ student.email }}</td>
              <td>{{ formatDate(student.createdAt) }}</td>
              <td><span class="status-pill" :class="{ disabled: student.status === 'disabled' }"><i></i>{{ student.status === 'disabled' ? '已停用' : '正常' }}</span></td>
              <td><div class="row-actions">
                <button v-if="isAdmin" class="btn btn-ghost" @click="toggleStatus(student)">{{ student.status === 'disabled' ? '启用' : '停用' }}</button>
                <button class="btn btn-ghost" @click="editStudent(student)">编辑</button>
                <button class="btn btn-danger" @click="deleteStudent(student)">删除</button>
              </div></td>
            </tr>
            <tr v-if="!loading && filteredStudents.length === 0"><td colspan="6" class="empty-cell">暂无学生账号</td></tr>
            <tr v-if="loading"><td colspan="6" class="empty-cell">加载中...</td></tr>
          </tbody>
        </table>
      </div>

      <aside v-if="selected" class="editor-card card">
        <div class="editor-head"><h2>编辑学生</h2><button class="btn btn-ghost" @click="closeEditor">关闭</button></div>
        <p class="account-hint">账号：{{ selected.account }}</p>
        <label class="label">姓名</label><input v-model="name" class="input" />
        <label class="label">QQ 邮箱</label><input v-model="email" class="input" type="email" />
        <label class="label">重置密码 <span class="hint">留空则不修改</span></label><input v-model="newPassword" class="input" type="password" minlength="6" />
        <button class="btn btn-primary save-btn" @click="saveStudent">保存修改</button>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:26px; }
.eyebrow { color:var(--brand-500); font-size:.72rem; letter-spacing:.14em; font-weight:800; margin-bottom:8px; }
.page-heading h1 { font-size:2.15rem; font-weight:750; letter-spacing:-.04em; }
.sub { color:var(--text-500); font-size:.95rem; margin-top:4px; }
.refresh-btn { padding:11px 16px; }
.summary-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:22px; }
.summary-card { display:flex; align-items:center; gap:14px; padding:19px 22px; border:1px solid var(--bg-200); box-shadow:0 8px 24px rgba(29,48,80,.05); }
.summary-icon { width:42px; height:42px; display:grid; place-items:center; border-radius:13px; font-size:1.15rem; }
.summary-icon.blue { background:#e9f3ff; color:#1971d4; }.summary-icon.green { background:#e9faf1; color:#1b9b5a; }.summary-icon.purple { background:#f1edff; color:#7354d8; }
.summary-label { display:block; color:var(--text-500); font-size:.78rem; margin-bottom:3px; }.summary-card strong { font-size:1.45rem; letter-spacing:-.03em; }
.toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 18px; margin-bottom:14px; border:1px solid var(--bg-200); }
.toolbar-title { display:flex; align-items:center; gap:9px; font-weight:750; color:var(--text-800); }.toolbar-title small { color:var(--text-500); font-size:.78rem; font-weight:500; margin-left:3px; }.dot { width:8px; height:8px; background:var(--brand-500); border-radius:50%; box-shadow:0 0 0 4px var(--brand-50); }
.search-input { width:300px; height:40px; }
.student-layout { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:22px; align-items:start; }
.table-card { padding:0; overflow-x:auto; min-height:360px; box-shadow:0 10px 28px rgba(29,48,80,.06); }
.student-table { width:100%; border-collapse:separate; border-spacing:0; font-size:.94rem; }
.student-table th,.student-table td { padding:19px 20px; text-align:left; border-bottom:1px solid var(--bg-200); white-space:nowrap; }
.student-table th { color:var(--text-500); background:var(--bg-100); font-size:.75rem; text-transform:uppercase; letter-spacing:.07em; }
.student-table th:first-child { border-radius:12px 0 0 0; }.student-table th:last-child { border-radius:0 12px 0 0; }
.student-table tbody tr { transition:background .18s ease; }.student-table tbody tr:hover { background:var(--bg-50); }
.student-table tbody tr:last-child td { border-bottom:none; }
.account { font-weight:700; color:var(--text-800); }
.student-profile { display:flex; align-items:center; gap:12px; }.student-profile strong { display:block; color:var(--text-800); }.student-profile small { display:block; margin-top:3px; color:var(--text-500); font-size:.75rem; }.student-avatar { width:40px; height:40px; display:grid; place-items:center; border-radius:12px; background:linear-gradient(135deg,var(--brand-400),var(--brand-600)); color:#fff; font-weight:750; }
.status-pill { display:inline-flex; align-items:center; gap:7px; padding:5px 10px; border-radius:999px; color:#188653; background:#eaf8f0; font-size:.78rem; font-weight:700; }.status-pill i { width:6px; height:6px; border-radius:50%; background:#25b86b; }
.row-actions { display:flex; gap:7px; }
.row-actions .btn { padding:7px 10px; font-size:.82rem; }
.empty-cell { text-align:center !important; color:var(--text-500); padding:48px 16px !important; }
.editor-card { padding:26px; position:sticky; top:24px; box-shadow:0 10px 28px rgba(29,48,80,.07); }
.editor-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
.editor-head h2 { font-size:1.2rem; }
.account-hint { color:var(--text-500); font-size:.88rem; margin-bottom:22px; }
.editor-card .label { display:block; margin:16px 0 7px; }
.hint { color:var(--text-500); font-weight:400; font-size:.78rem; }
.save-btn { width:100%; margin-top:24px; }
@media (max-width:980px) { .student-layout { grid-template-columns:1fr; } .editor-card { order:-1; position:static; } }
@media (max-width:700px) { .page-heading { align-items:stretch; flex-direction:column; } .summary-grid { grid-template-columns:1fr; } .toolbar { align-items:stretch; flex-direction:column; } .search-input { width:100%; } .student-table th,.student-table td { padding:15px 14px; } }
.status-pill.disabled i {
  background: var(--error, #ef4444);
}

.status-pill.disabled {
  color: var(--error, #ef4444);
}
</style>
