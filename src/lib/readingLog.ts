import { createStore, entries, get, set } from 'idb-keyval'

/** active reading seconds per local calendar day, keyed 'YYYY-MM-DD' */
export type ReadingLog = Record<string, number>

const store = createStore('reader-log-db', 'days')

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
  return enqueue(async () => {
    await set(key, ((await get<number>(key, store)) || 0) + secs, store)
  })
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
