<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useStore } from '../composables/useStore'
import { invoke } from '../services/bridge'
import type { User, UserRole } from '../types'

const { login, state, loadActivities } = useStore()

const isLoginMode = ref(true)
const isForgotMode = ref(false)
const role = ref<UserRole>('student')
const studentAccount = ref('')
const studentPassword = ref('')
const studentName = ref('')
const studentEmail = ref('')
const registrationCode = ref('')
const registrationSending = ref(false)
const registrationCooldown = ref(0)
const teacherAccount = ref('')
const teacherPassword = ref('')
const isSubmitting = ref(false)
const authError = ref('')
const resetAccount = ref('')
const resetCode = ref('')
const resetPassword = ref('')
const resetPasswordConfirm = ref('')
const resetCodeSent = ref(false)
const resetSubmitting = ref(false)
const resetCooldown = ref(0)
const registeredStudents = ref<number | null>(null)
let resetCooldownTimer: ReturnType<typeof setInterval> | undefined
let registrationCooldownTimer: ReturnType<typeof setInterval> | undefined

const activityCount = computed(() => state.activities.length)

onMounted(async () => {
  try {
    await loadActivities()
    const stats = await invoke<{ registeredStudents?: number }>('stats:public')
    registeredStudents.value = Number(stats?.registeredStudents ?? 0)
  } catch {
    registeredStudents.value = 0
  }
})

const email = computed({
  get: () => role.value === 'teacher' ? teacherAccount.value : studentAccount.value,
  set: (value: string) => {
    if (role.value === 'teacher') teacherAccount.value = value
    else studentAccount.value = value
  }
})
const password = computed({
  get: () => role.value === 'teacher' ? teacherPassword.value : studentPassword.value,
  set: (value: string) => {
    if (role.value === 'teacher') teacherPassword.value = value
    else studentPassword.value = value
  }
})
const name = computed({
  get: () => studentName.value,
  set: (value: string) => { studentName.value = value }
})

function toggleMode(e: Event) {
  e.preventDefault()
  clearForm()
  isForgotMode.value = false
  isLoginMode.value = !isLoginMode.value
}

function openForgotPassword(e: Event) {
  e.preventDefault()
  clearForm()
  role.value = 'student'
  isLoginMode.value = true
  isForgotMode.value = true
}

function backToLogin(e: Event) {
  e.preventDefault()
  clearForm()
  isForgotMode.value = false
  isLoginMode.value = true
}

function clearForm() {
  studentAccount.value = ''
  studentPassword.value = ''
  studentName.value = ''
  studentEmail.value = ''
  registrationCode.value = ''
  registrationCooldown.value = 0
  teacherAccount.value = ''
  teacherPassword.value = ''
  resetAccount.value = ''
  resetCode.value = ''
  resetPassword.value = ''
  resetPasswordConfirm.value = ''
  resetCodeSent.value = false
  resetSubmitting.value = false
  resetCooldown.value = 0
  if (resetCooldownTimer) {
    clearInterval(resetCooldownTimer)
    resetCooldownTimer = undefined
  }
  if (registrationCooldownTimer) {
    clearInterval(registrationCooldownTimer)
    registrationCooldownTimer = undefined
  }
  authError.value = ''
}

function clearAuthError() {
  if (authError.value) authError.value = ''
}

function selectRole(nextRole: UserRole) {
  if (nextRole !== role.value) {
    clearForm()
  }
  role.value = nextRole
  if (nextRole === 'teacher') isLoginMode.value = true
}

async function submit() {
  if (isSubmitting.value) return
  const account = email.value.trim()
  authError.value = ''
  isSubmitting.value = true
  try {
    if (isLoginMode.value) {
      const result = await invoke<{ user: User; token: string }>('auth:login', {
        account,
        password: password.value,
        role: role.value
      })
      await login(result.user, result.token)
      studentPassword.value = ''
      teacherPassword.value = ''
    } else {
      await invoke('auth:register', {
        account,
        password: password.value,
        name: name.value.trim(),
        role: role.value,
        email: studentEmail.value.trim(),
        verificationCode: registrationCode.value.trim(),
        rememberMe: false
      })
      clearForm()
      isLoginMode.value = true
      authError.value = '注册成功，请使用新账号登录'
    }
    isSubmitting.value = false
    return
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    authError.value = message.includes('QQ 邮箱') || message.includes('教师端') || message.includes('账号已经') || message.includes('完整')
      ? message
      : message.includes('该用户不存在')
        ? '该用户不存在'
      : message.includes('密码错误')
        ? '密码错误'
        : message.includes('账号已停用')
          ? message
        : message.includes('无法连接') || message.includes('登录状态已失效') || message.includes('请求失败')
          ? message
          : message.includes('__dirname') || message.includes('数据库暂时不可用')
            ? '数据库暂时不可用，请重启软件后重试'
            : isLoginMode.value
              ? (message || '登录失败，请检查账号和密码')
              : (message || '注册失败，请稍后重试')
    isSubmitting.value = false
    return
  }
}

function sendRegistrationCode() {
  if (registrationSending.value || registrationCooldown.value > 0) return
  registrationSending.value = true
  authError.value = ''
  invoke<{ maskedEmail?: string }>('auth:send-registration-code', { account: studentAccount.value.trim(), email: studentEmail.value.trim() })
    .then((result) => {
      authError.value = result?.maskedEmail ? `验证码已发送至 ${result.maskedEmail}` : '验证码已发送，请查收 QQ 邮箱'
      registrationCooldown.value = 60
      registrationCooldownTimer = setInterval(() => {
        registrationCooldown.value -= 1
        if (registrationCooldown.value <= 0 && registrationCooldownTimer) {
          clearInterval(registrationCooldownTimer)
          registrationCooldownTimer = undefined
        }
      }, 1000)
    })
    .catch((error: unknown) => { authError.value = error instanceof Error ? error.message : '验证码发送失败，请稍后重试' })
    .finally(() => { registrationSending.value = false })
}

function sendResetCode() {
  if (resetSubmitting.value || resetCooldown.value > 0) return
  const account = resetAccount.value.trim()
  authError.value = ''
  if (!account) {
    authError.value = '请输入注册时使用的账号'
    return
  }
  resetSubmitting.value = true
  invoke<{ maskedEmail?: string }>('auth:send-reset-code', { account })
    .then((result) => {
      resetCodeSent.value = true
      authError.value = result?.maskedEmail ? `验证码已发送至 ${result.maskedEmail}` : '验证码已发送，请查收 QQ 邮箱'
      resetCooldown.value = 60
      resetCooldownTimer = setInterval(() => {
        resetCooldown.value -= 1
        if (resetCooldown.value <= 0 && resetCooldownTimer) {
          clearInterval(resetCooldownTimer)
          resetCooldownTimer = undefined
        }
      }, 1000)
    })
    .catch((error: unknown) => {
      authError.value = error instanceof Error ? error.message : '验证码发送失败，请稍后重试'
    })
    .finally(() => { resetSubmitting.value = false })
}

async function submitReset() {
  if (resetSubmitting.value) return
  authError.value = ''
  if (resetPassword.value !== resetPasswordConfirm.value) {
    authError.value = '两次输入的新密码不一致'
    return
  }
  resetSubmitting.value = true
  try {
    await invoke('auth:reset-password', {
      account: resetAccount.value.trim(),
      code: resetCode.value.trim(),
      newPassword: resetPassword.value
    })
    clearForm()
    isForgotMode.value = false
    isLoginMode.value = true
    authError.value = '密码修改成功，请重新登录'
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '密码修改失败，请稍后重试'
  } finally {
    resetSubmitting.value = false
  }
}
</script>

<template>
  <section class="auth-screen">
    <div class="auth-visual">
      <div class="brand">CampusEvents</div>
      <div class="hero-copy">
        <h1>发现校园精彩<br />参与每一次成长</h1>
        <p>校园活动管理系统 V3.0 为学生和组织教师搭建桥梁：活动发现、报名与审核更简单，状态变化会主动通知，手机上也能顺畅使用。</p>
      </div>
      <div class="stats">
        <div class="stat"><strong>{{ activityCount }}</strong><span>活动总数</span></div>
        <div class="stat"><strong>{{ registeredStudents ?? '—' }}</strong><span>注册学生</span></div>
        <div class="stat"><strong>5</strong><span>活动类别</span></div>
      </div>
    </div>
    <div class="auth-form-panel">
      <div class="auth-box">
        <div class="mobile-brand">CampusEvents <span>V3.0</span></div>
        <h2>{{ isForgotMode ? '找回密码' : (isLoginMode ? '欢迎回来' : '创建账号') }}</h2>
        <p class="subtitle">{{ isForgotMode ? '通过 QQ 邮箱验证码安全重置密码' : (isLoginMode ? '登录 CampusEvents 继续你的校园旅程' : '注册 CampusEvents 开启校园活动新体验') }}</p>

        <div v-if="!isForgotMode" class="role-select">
          <label class="role-option" :class="{ active: role === 'student' }" @click="selectRole('student')">
            <input type="radio" v-model="role" value="student" />
            <div class="icon">🎓</div>
            <div class="title">学生</div>
            <div class="desc">浏览与报名活动</div>
          </label>
          <label class="role-option" :class="{ active: role === 'teacher' }" @click="selectRole('teacher')">
            <input type="radio" v-model="role" value="teacher" />
            <div class="icon">🍎</div>
            <div class="title">教师 / 管理员</div>
            <div class="desc">发布与管理活动</div>
          </label>
        </div>

        <p v-if="authError" class="auth-error" role="alert">{{ authError }}</p>
        <form v-if="!isForgotMode" @submit.prevent="submit">
          <div class="form-group">
            <label class="label">{{ role === 'teacher' ? '账号' : '学号 / 邮箱' }}</label>
            <input type="text" class="input" v-model="email" @input="clearAuthError" :placeholder="role === 'teacher' ? '请输入账号' : '请输入 16 位数字学号'" :maxlength="!isLoginMode && role === 'student' ? 16 : undefined" :minlength="!isLoginMode && role === 'student' ? 16 : undefined" :pattern="!isLoginMode && role === 'student' ? '\\d{16}' : undefined" :inputmode="role === 'student' ? 'numeric' : undefined" required />
          </div>
          <div class="form-group">
            <label class="label">密码</label>
            <input type="password" class="input" v-model="password" @input="clearAuthError" placeholder="输入密码" :minlength="!isLoginMode ? 6 : undefined" required />
          </div>
          <div class="form-group" v-show="!isLoginMode">
            <label class="label">姓名</label>
            <input type="text" class="input" v-model="name" @input="clearAuthError" placeholder="你的真实姓名" />
          </div>
          <div v-if="!isLoginMode && role === 'student'" class="form-group">
            <label class="label">QQ邮箱</label>
            <input type="email" class="input" v-model="studentEmail" @input="clearAuthError" placeholder="请输入 QQ 邮箱" required />
          </div>
          <div v-if="!isLoginMode && role === 'student'" class="form-group">
            <label class="label">邮箱验证码</label>
            <div class="code-row">
              <input type="text" class="input" v-model="registrationCode" @input="clearAuthError" placeholder="请输入 6 位验证码" inputmode="numeric" maxlength="6" required />
              <button type="button" class="btn btn-secondary code-button" :disabled="registrationSending || registrationCooldown > 0" @click="sendRegistrationCode">{{ registrationCooldown > 0 ? `${registrationCooldown}s后重试` : '获取验证码' }}</button>
            </div>
          </div>
          <div v-if="role !== 'teacher'" class="form-options" @click="openForgotPassword">
            <a href="#" class="link">忘记密码？</a>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%" :disabled="isSubmitting">{{ isSubmitting ? '处理中...' : (isLoginMode ? '登录' : '注册') }}</button>
        </form>

        <form v-else class="reset-form" @submit.prevent="submitReset">
          <div class="form-group">
            <label class="label">账号</label>
            <input class="input" type="text" v-model="resetAccount" @input="clearAuthError" placeholder="请输入注册时使用的账号" required />
          </div>
          <div class="form-group">
            <label class="label">验证码</label>
            <div class="code-row">
              <input class="input" type="text" v-model="resetCode" @input="clearAuthError" placeholder="请输入验证码" required />
              <button type="button" class="btn btn-secondary code-button" :disabled="resetSubmitting || resetCooldown > 0" @click="sendResetCode">{{ resetCooldown > 0 ? `${resetCooldown}s后重试` : '获取验证码' }}</button>
            </div>
          </div>
          <div class="form-group">
            <label class="label">新密码</label>
            <input class="input" type="password" v-model="resetPassword" @input="clearAuthError" placeholder="请输入新密码" required />
          </div>
          <div class="form-group">
            <label class="label">确认新密码</label>
            <input class="input" type="password" v-model="resetPasswordConfirm" @input="clearAuthError" placeholder="请再次输入新密码" required />
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%" :disabled="resetSubmitting">{{ resetSubmitting ? '处理中...' : '确认修改密码' }}</button>
          <div class="auth-footer"><a href="#" class="link" @click="backToLogin">返回登录</a></div>
        </form>

        <div v-if="role !== 'teacher'" class="auth-footer">
          <span>{{ isLoginMode ? '还没有账号？' : '已有账号？' }}</span>
          <a href="#" class="link" @click="toggleMode">{{ isLoginMode ? '立即注册' : '立即登录' }}</a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.auth-screen {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.auth-visual {
  position: relative;
  background: linear-gradient(145deg, #001a33 0%, #003b82 50%, #007aff 100%);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 64px;
  color: #fff;
  overflow: hidden;
}

.auth-visual::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 20% 30%, rgba(255,255,255,0.12) 0%, transparent 40%),
    radial-gradient(circle at 80% 70%, rgba(255,255,255,0.08) 0%, transparent 45%);
  pointer-events: none;
}

.brand, .hero-copy, .stats { position: relative; z-index: 1; }

.brand {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.hero-copy { max-width: 420px; }

.hero-copy h1 {
  font-size: 3.2rem;
  line-height: 1.05;
  font-weight: 700;
  letter-spacing: -0.04em;
  margin-bottom: 24px;
}

.hero-copy p {
  font-size: 1.1rem;
  line-height: 1.6;
  opacity: 0.82;
}

.stats { display: flex; gap: 48px; }

.stat strong {
  display: block;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.stat span {
  font-size: 0.9rem;
  opacity: 0.7;
}

.auth-form-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  background: var(--bg-50);
}

.auth-box {
  width: 100%;
  max-width: 420px;
}

.mobile-brand {
  display: none;
  align-items: baseline;
  gap: 8px;
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--brand-700);
  margin-bottom: 22px;
}

.mobile-brand span {
  font-size: 0.65rem;
  letter-spacing: 0.14em;
  color: var(--brand-500);
}

.auth-box h2 {
  font-size: 1.9rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 8px;
}

.auth-error {
  margin: -12px 0 16px;
  color: var(--state-error);
  font-size: 0.9rem;
}

.code-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
}

.code-button {
  white-space: nowrap;
  padding-left: 14px;
  padding-right: 14px;
}

.subtitle {
  color: var(--text-500);
  margin-bottom: 32px;
  font-size: 0.95rem;
}

.role-select {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
}

.role-option {
  position: relative;
  padding: 16px;
  border: 2px solid var(--bg-300);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
  text-align: center;
}

.role-option:hover { border-color: var(--brand-300); }
.role-option.active { border-color: var(--brand-500); background: var(--brand-50); }

.role-option input { position: absolute; opacity: 0; }

.role-option .icon {
  width: 44px;
  height: 44px;
  margin: 0 auto 10px;
  border-radius: 12px;
  background: var(--bg-200);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
  transition: background 0.2s ease;
}

.role-option.active .icon { background: var(--brand-500); color: #fff; }
.role-option .title { font-weight: 700; font-size: 0.95rem; }
.role-option .desc { font-size: 0.8rem; color: var(--text-500); margin-top: 4px; }

.form-group { margin-bottom: 20px; }

.form-options {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin: -8px 0 24px;
  font-size: 0.85rem;
}

.auth-footer {
  text-align: center;
  margin-top: 24px;
  font-size: 0.9rem;
  color: var(--text-500);
}

@media (max-width: 980px) {
  .auth-screen { grid-template-columns: 1fr; }
  .auth-visual { display: none; }
  .auth-form-panel { padding: 28px 20px; align-items: flex-start; }
  .mobile-brand { display: flex; }
}
</style>
