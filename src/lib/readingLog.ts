import { createStore, entries, get, set } from 'idb-keyval'

/** active reading seconds per local calendar day, keyed 'YYYY-MM-DD' */
export type ReadingLog = Record<string, number>

const store = createStore('reader-log-db', 'days')
/** active reading seconds per local hour, keyed 'YYYY-MM-DDTHH': feeds the time-of-day heatmap */
const hourStore = createStore('reader-hours-db', 'hours')
export type ReadingHours = Record<string, number>

/** a day with at least this much reading counts toward the streak when no goal is set */
const MIN_STREAK_SECS = 60

const pad = (n: number) => String(n).padStart(2, '0')

export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** the day `delta` days away from `key`, computed on the calendar so DST shifts never skip or repeat a day */
export function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return dayKey(new Date(y!, m! - 1, d! + delta).getTime())
}

/** read-modify-write calls are chained so overlapping flushes never lose an increment */
let queue: Promise<unknown> = Promise.resolve()
const enqueue = (fn: () => Promise<void>) => {
  queue = queue.then(fn, fn).catch((e) => console.warn('reading log write failed', e))
  return queue as Promise<void>
}

export function addReadingTime(secs: number, now = Date.now()): Promise<void> {
  if (secs <= 0) return Promise.resolve()
  const key = dayKey(now)
  const hKey = `${key}T${pad(new Date(now).getHours())}`
  return enqueue(async () => {
    await set(key, ((await get<number>(key, store)) || 0) + secs, store)
    await set(hKey, ((await get<number>(hKey, hourStore)) || 0) + secs, hourStore)
  })
}

export async function loadReadingHours(): Promise<ReadingHours> {
  try {
    await queue
    const hours: ReadingHours = {}
    for (const [k, v] of await entries<string, number>(hourStore)) if (Number(v) > 0) hours[k] = Number(v)
    return hours
  } catch (e) {
    console.warn('reading hours read failed', e)
    return {}
  }
}

/** per hour, keep the larger side, like the daily log */
export function mergeReadingHours(incoming: ReadingHours): Promise<void> {
  return enqueue(async () => {
    for (const [k, v] of Object.entries(incoming)) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(k) || !(Number(v) > 0)) continue
      if (Number(v) > ((await get<number>(k, hourStore)) || 0)) await set(k, Number(v), hourStore)
    }
  })
}

/** seconds by weekday (0 = Sunday) and hour of day (0-23) */
export function weekdayHourMatrix(hours: ReadingHours): number[][] {
  const m = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  for (const [k, v] of Object.entries(hours)) {
    const [y, mo, d] = k.slice(0, 10).split('-').map(Number)
    const h = Number(k.slice(11, 13))
    if (h >= 0 && h < 24) m[new Date(y!, mo! - 1, d!).getDay()]![h]! += v
  }
  return m
}

/** 0 (nothing) to 4 (the busiest), so a heatmap cell can pick one of a few shades */
export function heatLevel(secs: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (secs <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((secs / max) * 4))) as 1 | 2 | 3 | 4
}

/** the last `weeks` calendar weeks (Sunday first) ending with the week of `today`; days after today are null */
export function heatmapWeeks(log: ReadingLog, today: string, weeks = 53): ({ key: string; secs: number } | null)[][] {
  const [y, m, d] = today.split('-').map(Number)
  const dow = new Date(y!, m! - 1, d!).getDay()
  const start = shiftDay(today, -dow - (weeks - 1) * 7)
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const key = shiftDay(start, w * 7 + i)
      return key > today ? null : { key, secs: log[key] ?? 0 }
    }),
  )
}

export interface YearProgress {
  secs: number
  /** the year's total if the pace so far continues to December 31st */
  projectedSecs: number
}

export function yearProgress(log: ReadingLog, today: string): YearProgress {
  const year = today.slice(0, 4)
  const secs = Object.entries(log).reduce((a, [k, v]) => (k.startsWith(year) && k <= today ? a + v : a), 0)
  const y = Number(year)
  const daysIn = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 864e5) + 1
  const dayNo = daysIn(new Date(y, 0, 1), new Date(y, Number(today.slice(5, 7)) - 1, Number(today.slice(8))))
  const total = daysIn(new Date(y, 0, 1), new Date(y, 11, 31))
  return { secs, projectedSecs: Math.round((secs / dayNo) * total) }
}

export async function loadReadingLog(): Promise<ReadingLog> {
  try {
    await queue
    const log: ReadingLog = {}
    for (const [k, v] of await entries<string, number>(store)) if (Number(v) > 0) log[k] = Number(v)
    return log
  } catch (e) {
    console.warn('reading log read failed', e)
    return {}
  }
}

/** per day, keep the larger side, so restoring a backup never loses reading done on this device */
export function mergeReadingLog(incoming: ReadingLog): Promise<void> {
  return enqueue(async () => {
    for (const [k, v] of Object.entries(incoming)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !(Number(v) > 0)) continue
      if (Number(v) > ((await get<number>(k, store)) || 0)) await set(k, Number(v), store)
    }
  })
}

/** consecutive days ending today (or yesterday while today is still short of the target) that met the target */
export function currentStreak(log: ReadingLog, goalSecs: number, today: string): number {
  const need = Math.max(goalSecs, MIN_STREAK_SECS)
  let day = (log[today] ?? 0) >= need ? today : shiftDay(today, -1)
  let n = 0
  while ((log[day] ?? 0) >= need) {
    n++
    day = shiftDay(day, -1)
  }
  return n
}

export function lastDays(log: ReadingLog, count: number, today: string): { key: string; secs: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const key = shiftDay(today, i - count + 1)
    return { key, secs: log[key] ?? 0 }
  })
}

export interface WeekSummary {
  totalSecs: number
  /** days among the last seven with any reading */
  activeDays: number
  /** days among the last seven that reached the goal (0 when no goal is set) */
  goalDays: number
}

export function weekSummary(log: ReadingLog, goalSecs: number, today: string): WeekSummary {
  const days = lastDays(log, 7, today)
  return {
    totalSecs: days.reduce((a, d) => a + d.secs, 0),
    activeDays: days.filter((d) => d.secs > 0).length,
    goalDays: goalSecs > 0 ? days.filter((d) => d.secs >= goalSecs).length : 0,
  }
}
