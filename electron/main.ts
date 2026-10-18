import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { channels } from './channels'
import { setupElectronPlatform } from './platform-electron'
import { resolveActor } from './session'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ out
// │ │ ├─┬ main
// │ │ │ └── main.js
// │ │
// │ │ ├─┬ preload
// │ │ │ └── preload.cjs
// │ │ └─┬ renderer
// │ │   └── index.html
// │
process.env.APP_ROOT = path.join(__dirname, '..', '..')

export const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'out', 'main')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'out', 'renderer')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    width: 1232,
    height: 920,
    minWidth: 1232,
    minHeight: 920,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(process.env.APP_ROOT, 'out', 'preload', 'preload.cjs'),
    },
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      event.preventDefault()
      win?.webContents.toggleDevTools()
    }
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  // Remove Electron's default application menu (File / Edit / View / Window / Help).
  Menu.setApplicationMenu(null)
  // 数据目录、wasm 资源与系统密钥加密能力由运行环境层提供
  setupElectronPlatform(process.env.VITE_PUBLIC)
  for (const [channel, handler] of Object.entries(channels)) {
    ipcMain.handle(channel, (_event, request: { token?: string; payload?: unknown }) => {
      const isEnvelope = request !== null && typeof request === 'object' && ('payload' in request || 'token' in request)
      const token = isEnvelope && typeof request.token === 'string' ? request.token : null
      return handler(isEnvelope ? request.payload ?? null : request, { actor: resolveActor(token), token })
    })
  }
  createWindow()
})
