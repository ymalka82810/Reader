/** per-book reading speed: active seconds spent and the fraction of the book read in that time */
interface Stats {
  secs: number
  frac: number
}

const key = (id: string) => `reader:stats:${id}`

export function loadStats(id: string): Stats {
  try {
    const s = JSON.parse(localStorage.getItem(key(id)) ?? '{}')
    return { secs: Number(s.secs) || 0, frac: Number(s.frac) || 0 }
  } catch {
    return { secs: 0, frac: 0 }
  }
}

export function addStats(id: string, secs: number, frac: number) {
  if (secs <= 0 && frac <= 0) return
  const cur = loadStats(id)
  try {
    localStorage.setItem(key(id), JSON.stringify({ secs: cur.secs + secs, frac: cur.frac + frac }))
  } catch {
    /* ignore */
  }
}

/** minutes left at the reader's own pace, or null while there is too little data */
export function minutesLeft(id: string, fraction: number): number | null {
  const { secs, frac } = loadStats(id)
  if (secs < 120 || frac < 0.005) return null
  return Math.max(1, Math.round(((1 - fraction) * (secs / frac)) / 60))
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} דק׳`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} שע׳ ${r} דק׳` : `${h} שע׳`
}
