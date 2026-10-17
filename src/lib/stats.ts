import { createStore, del, get, set } from 'idb-keyval'
import { t } from '../i18n'

/** per-book reading speed: active seconds spent and the fraction of the book read in that time */
export interface Stats {
  secs: number
  frac: number
}

const store = createStore('reader-stats-db', 'stats')
const legacyKey = (id: string) => `reader:stats:${id}`

const clean = (s: any): Stats => ({ secs: Number(s?.secs) || 0, frac: Number(s?.frac) || 0 })

/** stats used to live in localStorage; move an old entry into IndexedDB the first time it is read */
async function migrateLegacy(id: string): Promise<Stats | undefined> {
  try {
    const raw = localStorage.getItem(legacyKey(id))
    if (raw === null) return undefined
    const s = clean(JSON.parse(raw))
    await set(id, s, store)
    localStorage.removeItem(legacyKey(id))
    return s
  } catch (e) {
    console.warn('legacy stats migration failed', e)
    return undefined
  }
}

export async function loadStats(id: string): Promise<Stats> {
  try {
    const s = await get<Stats>(id, store)
    if (s) return clean(s)
    return (await migrateLegacy(id)) ?? { secs: 0, frac: 0 }
  } catch (e) {
    console.warn('stats read failed', e)
    return { secs: 0, frac: 0 }
  }
}

/** read-modify-write calls are chained so overlapping flushes never lose an increment */
let queue: Promise<unknown> = Promise.resolve()
const enqueue = (fn: () => Promise<void>) => {
  // stats are best-effort: a failed write is logged and must not block later ones
  queue = queue.then(fn, fn).catch((e) => console.warn('stats write failed', e))
  return queue as Promise<void>
}

export function addStats(id: string, secs: number, frac: number): Promise<void> {
  if (secs <= 0 && frac <= 0) return Promise.resolve()
  return enqueue(async () => {
    const cur = await loadStats(id)
    await set(id, { secs: cur.secs + secs, frac: cur.frac + frac }, store)
  })
}

/** minutes left at the reader's own pace, or null while there is too little data */
export function minutesLeft({ secs, frac }: Stats, fraction: number): number | null {
  if (secs < 120 || frac < 0.005) return null
  return Math.max(1, Math.round(((1 - fraction) * (secs / frac)) / 60))
}

export function formatMinutes(m: number): string {
  if (m < 60) return t('time.min', { m })
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${t('time.hour', { h })} ${t('time.min', { m: r })}` : t('time.hour', { h })
}

export function deleteStats(id: string): Promise<void> {
  try {
    localStorage.removeItem(legacyKey(id))
  } catch {
    /* localStorage unavailable: the legacy key is cleaned up on a later read */
  }
  return enqueue(() => del(id, store))
}

/** keep whichever side has more reading data, so restoring never loses stats */
export function mergeStats(id: string, incoming: Stats): Promise<void> {
  return enqueue(async () => {
    const cur = await loadStats(id)
    if (incoming.secs <= cur.secs) return
    await set(id, { secs: incoming.secs, frac: incoming.frac }, store)
  })
}
