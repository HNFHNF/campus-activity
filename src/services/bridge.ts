/**
 * 前端访问数据的统一入口。
 *
 * - 在 Electron 窗口里：调用 preload 暴露的 ipcRenderer.invoke；
 * - 在普通浏览器里：调用本地 API 服务（POST /api/<通道名>），
 *   服务端复用 electron/channels.ts 中同一批处理函数。
 *
 * 因此界面代码不需要关心自己跑在哪种环境里。
 */

type IpcRendererLike = {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

let authToken: string | null = null

/** 登录成功后保存令牌，退出登录时清空 */
export function setAuthToken(token: string | null) {
  authToken = token
}

let onSessionExpired: (() => void) | undefined

/** 令牌失效（例如服务重启）时的回调，由状态层接管：清空登录态并提示重新登录 */
export function setSessionExpiredHandler(handler: (() => void) | undefined) {
  onSessionExpired = handler
}

const SESSION_EXPIRED_HINT = '登录状态已失效'

function toUserFacingError(message: string) {
  if (message.includes(SESSION_EXPIRED_HINT)) {
    setAuthToken(null)
    onSessionExpired?.()
    return new Error('登录状态已失效，请重新登录')
  }
  return new Error(message || '操作失败，请稍后重试')
}

function getIpcRenderer(): IpcRendererLike | undefined {
  const candidate = (globalThis as { ipcRenderer?: Partial<IpcRendererLike> }).ipcRenderer
  return typeof candidate?.invoke === 'function' ? (candidate as IpcRendererLike) : undefined
}

/** 当前是否运行在 Electron 窗口中 */
export function isDesktopRuntime() {
  return getIpcRenderer() !== undefined
}

export async function invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  const ipcRenderer = getIpcRenderer()
  const request = { token: authToken, payload: payload ?? null }
  if (ipcRenderer) {
    try {
      return (await ipcRenderer.invoke(channel, request)) as T
    } catch (error) {
      throw toUserFacingError(error instanceof Error ? error.message : String(error ?? ''))
    }
  }

  let response: Response
  try {
    response = await fetch(`/api/${encodeURIComponent(channel)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    throw new Error('无法连接本地服务，请确认已执行 npm run web 启动网页版服务')
  }

  const text = await response.text()
  const data = text ? (JSON.parse(text) as { result?: T; error?: string }) : {}
  if (!response.ok) throw toUserFacingError(data.error || `请求失败（HTTP ${response.status}）`)
  return data.result as T
}
