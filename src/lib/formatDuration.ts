import { t } from '../i18n'

/** a countdown as readable text: seconds only under a minute, then minutes + seconds, then hours + minutes + seconds */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60

  const parts: string[] = []
  if (h > 0) parts.push(t('dur.hour', { n: h }))
  if (m > 0) parts.push(t('dur.min', { n: m }))
  if (sec > 0 || parts.length === 0) parts.push(t('dur.sec', { n: sec }))

  const last = parts.pop() ?? ''
  const head = parts
  if (head.length === 0) return last
  return `${head.join(', ')} ${t(/^\d/.test(last) ? 'dur.andNum' : 'dur.and', { b: last })}`
}
