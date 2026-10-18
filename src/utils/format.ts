function parseDate(str: string): Date {
  return new Date(str.includes('T') ? str : str.replace(' ', 'T'))
}

export function formatDate(str: string): string {
  const d = parseDate(str)
  if (isNaN(d.getTime())) return str
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 卡片/移动端使用的短时间：10月24日 19:30 */
export function formatDateTimeShort(str: string): string {
  const d = parseDate(str)
  if (isNaN(d.getTime())) return str
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function getMonthDay(str: string): { month: number; day: number } {
  const d = parseDate(str)
  if (isNaN(d.getTime())) return { month: 0, day: 0 }
  return { month: d.getMonth() + 1, day: d.getDate() }
}

export function isWeekendDate(str: string): boolean {
  const d = parseDate(str)
  if (isNaN(d.getTime())) return false
  const day = d.getDay()
  return day === 0 || day === 6
}
