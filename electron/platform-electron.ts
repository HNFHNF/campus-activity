import { app, safeStorage } from 'electron'
import { setPlatform } from './platform'

/** 在 Electron 主进程启动时调用，使用系统密钥加密（Windows 下为 DPAPI）保存数据库密钥 */
export function setupElectronPlatform(wasmDir: string) {
  setPlatform({
    kind: 'electron',
    dataDir: app.getPath('userData'),
    wasmDir,
    keyProtector: {
      get available() {
        return safeStorage.isEncryptionAvailable()
      },
      encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
      decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
    },
  })
}
