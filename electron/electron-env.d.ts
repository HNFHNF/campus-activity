/// <reference types="electron-vite/node" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ out
     * │ │ ├─┬ main
     * │ │ │ └── main.js
     * │ │
     * │ │ ├─┬ preload
     * │ │ │ └── preload.cjs
     * │ │ └─┬ renderer
     * │ │   └── index.html
     * │
     * ```
     */
    APP_ROOT: string
    /** /out/renderer/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  /** Electron 窗口里由 preload 注入；浏览器版本中为 undefined */
  ipcRenderer?: import('electron').IpcRenderer
}
