/** 侧边栏与移动端底部导航共用的 SVG 图标路径，避免两处各写一份。 */
const iconPaths: Record<string, string> = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  ticket: '<path d="M16 3.467a7.49 7.49 0 0 0-4.5 0"/><path d="M4 7.997A5.54 5.54 0 0 1 7.5 4.45a7.49 7.49 0 0 1 9 0A5.54 5.54 0 0 1 20 7.997"/><path d="M18.5 9.5v.5H19a4 4 0 0 1 4 4v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-7a4 4 0 0 1 4-4h.5v-.5"/><circle cx="12" cy="14" r="2"/>',
  plus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'
}

export function iconSvg(name: string): string {
  return iconPaths[name] ?? ''
}
