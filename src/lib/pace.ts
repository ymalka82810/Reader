import type { Stats } from './stats'

/**
 * Auto-reading paces itself in seconds per KB of book source. Unlike pages or pixels, bytes don't
 * change with font size or screen size, so a pace learned on one layout (or one book) carries over.
 */
export const DEFAULT_SECS_PER_KB = 20
const MIN_SECS_PER_KB = 1
const MAX_SECS_PER_KB = 300
/** a screen never moves faster or slower than this, whatever the section's text density */
const MIN_SCREEN_SECS = 3
const MAX_SCREEN_SECS = 600
/** how long a screen of a section with no text (cover, image page) stays up */
const EMPTY_SCREEN_SECS = 5
/** one press of faster/slower changes the pace by this factor */
export const PACE_STEP = 1.15

const KEY = 'reader:pace'

/** byte size of each section that counts towards reading progress (non-linear ones count as 0) */
export const linearSizes = (sections: { size?: number; linear?: string }[]) =>
  sections.map((s) => (s.linear !== 'no' && (s.size ?? 0) > 0 ? s.size! : 0))

export const clampPace = (p: number) => Math.min(MAX_SECS_PER_KB, Math.max(MIN_SECS_PER_KB, p))

/** the reader's own pace in this book, from its reading stats; null while there is too little data */
export function paceFromStats({ secs, frac }: Stats, totalBytes: number): number | null {
  if (secs < 120 || frac < 0.005 || totalBytes <= 0) return null
  return clampPace(((secs / frac) * 1000) / totalBytes)
}

/** seconds one screen of the current section should stay up at `secsPerKB` */
export function screenSecs(secsPerKB: number, sectionBytes: number, screens: number): number {
  if (sectionBytes <= 0 || !(screens > 0)) return EMPTY_SCREEN_SECS
  const secs = (secsPerKB * sectionBytes) / 1000 / screens
  return Math.min(MAX_SCREEN_SECS, Math.max(MIN_SCREEN_SECS, secs))
}

/** the last pace used in any book: the starting point for books without stats of their own */
export function loadPace(): number {
  try {
    const p = Number(localStorage.getItem(KEY))
    return p > 0 ? clampPace(p) : DEFAULT_SECS_PER_KB
  } catch {
    return DEFAULT_SECS_PER_KB
  }
}

export function savePace(p: number) {
  try {
    localStorage.setItem(KEY, String(clampPace(p)))
  } catch {
    /* localStorage unavailable or full: the setting just won't persist */
  }
}
