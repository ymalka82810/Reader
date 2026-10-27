import type { Stats } from './stats'

/**
 * Paces are kept in seconds per KB of book source: foliate measures what is left in source bytes, and bytes don't
 * change with font or screen size. Bytes are not words, though: a Hebrew word takes about twice the bytes of an
 * English one, and a book with heavy markup more than a clean one. So what is learned about the reader across books
 * is kept in seconds per word, and turned into seconds per KB for each book by that book's own bytes per word.
 */
export const DEFAULT_SECS_PER_KB = 20
/** a typical adult reading pace (about 230 words a minute): the start before anything is learned */
export const DEFAULT_SECS_PER_WORD = 60 / 230
const MIN_SECS_PER_KB = 1
const MAX_SECS_PER_KB = 300
const MIN_SECS_PER_WORD = 0.03
const MAX_SECS_PER_WORD = 3
/** reading time in a book at which its own pace and the personal pace weigh the same */
export const BOOK_TRUST_SECS = 600
/** the personal pace is used once this much was read */
const MIN_PROFILE_SECS = 120
const MIN_PROFILE_WORDS = 500
/** older reading counts half after this many newer words (about half a novel), so the pace follows the reader */
export const HALF_LIFE_WORDS = 60_000
/** a screen never moves faster or slower than this, whatever the section's text density */
const MIN_SCREEN_SECS = 3
const MAX_SCREEN_SECS = 600
/** how long a screen of a section with no text (cover, image page) stays up */
const EMPTY_SCREEN_SECS = 5
/** one press of faster/slower changes the pace by this factor */
export const PACE_STEP = 1.15

const PROFILE_KEY = 'reader:readingPace'

/** byte size of each section that counts towards reading progress (non-linear ones count as 0) */
export const linearSizes = (sections: { size?: number; linear?: string }[]) =>
  sections.map((s) => (s.linear !== 'no' && (s.size ?? 0) > 0 ? s.size! : 0))

export const clampPace = (p: number) => Math.min(MAX_SECS_PER_KB, Math.max(MIN_SECS_PER_KB, p))

/** the reader's pace across all books: reading seconds and words, older reading fading out */
export interface PaceProfile {
  secs: number
  words: number
}

export function loadProfile(): PaceProfile {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null')
    return { secs: Number(p?.secs) || 0, words: Number(p?.words) || 0 }
  } catch {
    return { secs: 0, words: 0 }
  }
}

/** adds reading time and the words read in it (from any book) to the personal pace */
export function learnPace(secs: number, words: number) {
  if (!(secs > 0) && !(words > 0)) return
  const p = loadProfile()
  const keep = 0.5 ** (Math.max(0, words) / HALF_LIFE_WORDS)
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ secs: p.secs * keep + Math.max(0, secs), words: p.words * keep + Math.max(0, words) }))
  } catch {
    /* localStorage unavailable or full: the pace just isn't learned this time */
  }
}

/** seconds per word across all books; null while too little was read */
export function personalSecsPerWord(p: PaceProfile = loadProfile()): number | null {
  if (p.secs < MIN_PROFILE_SECS || p.words < MIN_PROFILE_WORDS) return null
  return Math.min(MAX_SECS_PER_WORD, Math.max(MIN_SECS_PER_WORD, p.secs / p.words))
}

/**
 * The pace to use in one book, in seconds per KB. It starts from the personal pace (seconds per word, turned into
 * this book's bytes) and moves towards the pace measured in this book as reading time in it adds up: after
 * BOOK_TRUST_SECS both weigh the same. The two are blended on a log scale, so one noisy start can't swing it wildly.
 */
export function estimatePace({ stats, totalBytes, words }: { stats: Stats; totalBytes: number; words: number | null }): number {
  const bytesPerWord = words && words > 0 && totalBytes > 0 ? totalBytes / words : null
  const prior = bytesPerWord ? ((personalSecsPerWord() ?? DEFAULT_SECS_PER_WORD) * 1000) / bytesPerWord : DEFAULT_SECS_PER_KB
  const own = stats.secs > 0 && stats.frac > 0 && totalBytes > 0 ? (stats.secs / stats.frac / totalBytes) * 1000 : null
  if (own === null) return clampPace(prior)
  const w = stats.secs / (stats.secs + BOOK_TRUST_SECS)
  return clampPace(Math.exp(w * Math.log(clampPace(own)) + (1 - w) * Math.log(clampPace(prior))))
}

/** seconds one screen of the current section should stay up at `secsPerKB` */
export function screenSecs(secsPerKB: number, sectionBytes: number, screens: number): number {
  if (sectionBytes <= 0 || !(screens > 0)) return EMPTY_SCREEN_SECS
  const secs = (secsPerKB * sectionBytes) / 1000 / screens
  return Math.min(MAX_SCREEN_SECS, Math.max(MIN_SCREEN_SECS, secs))
}

const AUTO_KEY = 'reader:autoPaceFactor'

/** how much faster or slower than the estimated pace auto-reading was last set to (1 = as estimated) */
export function loadAutoFactor(): number {
  try {
    const f = Number(localStorage.getItem(AUTO_KEY))
    return f > 0 ? Math.min(20, Math.max(0.05, f)) : 1
  } catch {
    return 1
  }
}

export function saveAutoFactor(f: number) {
  try {
    localStorage.setItem(AUTO_KEY, String(f))
  } catch {
    /* localStorage unavailable or full: the setting just won't persist */
  }
}
