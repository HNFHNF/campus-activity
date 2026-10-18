/**
 * 运行环境抽象层。
 *
 * 同一套数据库/业务代码既跑在 Electron 主进程里（桌面应用），
 * 也跑在普通 Node 进程里（浏览器版本的本地 API 服务）。
 * 两者差异只有三处：数据目录、wasm 资源目录、密钥加密方式，
 * 因此在这里统一注入，业务代码只调用 getPlatform()。
 */

export type KeyProtector = {
  /** 当前系统是否提供可用的密钥加密服务 */
  available: boolean
  /** 把明文密钥转换成可以写入磁盘的字符串 */
  encrypt: (plain: string) => string
  /** 还原 encrypt() 写入的字符串 */
  decrypt: (protectedValue: string) => string
}

export type Platform = {
  /** 加密数据库与密钥文件所在目录 */
  dataDir: string
  /** sql-wasm.wasm 所在目录 */
  wasmDir: string
  keyProtector: KeyProtector
  /** 运行形态，仅用于日志和错误提示 */
  kind: 'electron' | 'node'
}

let current: Platform | undefined

export function setPlatform(platform: Platform) {
  current = platform
}

export function getPlatform(): Platform {
  if (!current) throw new Error('运行环境尚未初始化，无法访问本地数据库')
  return current
}
