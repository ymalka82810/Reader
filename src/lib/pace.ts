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

/** reading seconds and the words read in them; in the profiles, older reading fades out */
export interface PaceProfile {
  secs: number
  words: number
}

/**
 * Everything learned about the reader's pace: across all books, per book language (a bilingual reader is usually
 * faster in one of them), and plain totals per month and language for the speed history.
 */
export interface PaceData {
  all: PaceProfile
  langs: Record<string, PaceProfile>
  /** 'YYYY-MM' → language → totals of that month (not faded) */
  months: Record<string, Record<string, PaceProfile>>
}

/** months of speed history kept */
const MONTHS_KEPT = 24
/** a month, a language or a book shows a speed once this much was read in it */
const MIN_SHOWN_SECS = 300
const MIN_SHOWN_WORDS = 500
/** a book is compared with the reader's usual speed after this much reading in it */
const MIN_BOOK_SECS = 600
/** the language of a book whose language is not known */
const NO_LANG = '?'

const cleanProfile = (p: unknown): PaceProfile => {
  const o = (p ?? {}) as Partial<PaceProfile>
  return { secs: Number(o.secs) > 0 ? Number(o.secs) : 0, words: Number(o.words) > 0 ? Number(o.words) : 0 }
}
const mapProfiles = (o: unknown): Record<string, PaceProfile> =>
  Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).map(([k, v]) => [k, cleanProfile(v)]))

export function loadPaceData(): PaceData {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null')
    // the first version kept only { secs, words } across all books
    if (raw && 'secs' in raw) return { all: cleanProfile(raw), langs: {}, months: {} }
    return {
      all: cleanProfile(raw?.all),
      langs: mapProfiles(raw?.langs),
      months: Object.fromEntries(Object.entries(raw?.months && typeof raw.months === 'object' ? raw.months : {}).map(([k, v]) => [k, mapProfiles(v)])),
    }
  } catch {
    return { all: { secs: 0, words: 0 }, langs: {}, months: {} }
  }
}

function savePaceData(d: PaceData) {
  const keep = Object.keys(d.months).sort().slice(-MONTHS_KEPT)
  const months = Object.fromEntries(keep.map((k) => [k, d.months[k]!]))
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...d, months }))
  } catch {
    /* localStorage unavailable or full: the pace just isn't learned this time */
  }
}

/** a book's language as the pace keeps it: the primary code ('he-IL' → 'he'; the old 'iw' → 'he') */
export function paceLang(lang: string | null | undefined): string {
  const l = (lang ?? '').toLowerCase().match(/^[a-z]{2,3}/)?.[0]
  if (!l) return NO_LANG
  return l === 'iw' ? 'he' : l
}

const monthKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const fade = (p: PaceProfile | undefined, secs: number, words: number): PaceProfile => {
  const keep = 0.5 ** (words / HALF_LIFE_WORDS)
  return { secs: (p?.secs ?? 0) * keep + secs, words: (p?.words ?? 0) * keep + words }
}

/** adds reading time and the words read in it (from a book in `lang`) to the personal pace and the month's totals */
export function learnPace(secs: number, words: number, lang?: string | null, now = Date.now()) {
  secs = Math.max(0, secs || 0)
  words = Math.max(0, words || 0)
  if (!secs && !words) return
  const d = loadPaceData()
  const l = paceLang(lang)
  d.all = fade(d.all, secs, words)
  if (l !== NO_LANG) d.langs[l] = fade(d.langs[l], secs, words)
  const m = (d.months[monthKey(now)] ??= {})
  m[l] = { secs: (m[l]?.secs ?? 0) + secs, words: (m[l]?.words ?? 0) + words }
  savePaceData(d)
}

const enough = (p: PaceProfile | undefined) => !!p && p.secs >= MIN_PROFILE_SECS && p.words >= MIN_PROFILE_WORDS
const secsPerWordOf = (p: PaceProfile) => Math.min(MAX_SECS_PER_WORD, Math.max(MIN_SECS_PER_WORD, p.secs / p.words))

/** seconds per word: in this language when enough was read in it, else across all books; null while too little was read */
export function personalSecsPerWord(lang?: string | null, d: PaceData = loadPaceData()): number | null {
  const own = lang ? d.langs[paceLang(lang)] : undefined
  if (enough(own)) return secsPerWordOf(own!)
  return enough(d.all) ? secsPerWordOf(d.all) : null
}

/** words per minute at `secsPerWord` */
export const wpm = (secsPerWord: number) => Math.round(60 / secsPerWord)

const shownWpm = (p: PaceProfile | undefined) =>
  p && p.secs >= MIN_SHOWN_SECS && p.words >= MIN_SHOWN_WORDS ? Math.round(p.words / (p.secs / 60)) : null

/** words per minute in each of the last `count` months up to `now`, oldest first (null = too little reading) */
export function monthlyWpm(d: PaceData, now = Date.now(), count = 12): { key: string; wpm: number | null }[] {
  const end = new Date(now)
  return Array.from({ length: count }, (_, i) => {
    const key = monthKey(new Date(end.getFullYear(), end.getMonth() - (count - 1 - i), 1).getTime())
    const total = Object.values(d.months[key] ?? {}).reduce((a, p) => ({ secs: a.secs + p.secs, words: a.words + p.words }), { secs: 0, words: 0 })
    return { key, wpm: shownWpm(total) }
  })
}

/** words per minute in each book language read enough, the most read first */
export function wpmByLanguage(d: PaceData): { lang: string; wpm: number }[] {
  const totals: Record<string, PaceProfile> = {}
  for (const month of Object.values(d.months))
    for (const [l, p] of Object.entries(month)) {
      if (l === NO_LANG) continue
      totals[l] = { secs: (totals[l]?.secs ?? 0) + p.secs, words: (totals[l]?.words ?? 0) + p.words }
    }
  return Object.entries(totals)
    .sort((a, b) => b[1].words - a[1].words)
    .flatMap(([lang, p]) => {
      const w = shownWpm(p)
      return w === null ? [] : [{ lang, wpm: w }]
    })
}

/**
 * Books read clearly faster or slower than usual: each book's words per minute (from its reading time and how much
 * of it was read) against `usualWpm`, as a ratio. Only books read at least MIN_BOOK_SECS, the furthest from usual first.
 */
export function bookSpeeds(
  books: { id: string; title: string; words?: number }[],
  stats: Map<string, { secs: number; frac: number }>,
  usualWpm: number,
): { id: string; title: string; wpm: number; ratio: number }[] {
  return books
    .flatMap((b) => {
      const s = stats.get(b.id)
      if (!s || !b.words || s.secs < MIN_BOOK_SECS || !(s.frac > 0)) return []
      const w = Math.round((b.words * Math.min(1, s.frac)) / (s.secs / 60))
      return [{ id: b.id, title: b.title, wpm: w, ratio: w / usualWpm }]
    })
    .sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)))
}

/** a restored backup: profiles keep whichever side read more, months per language likewise */
export function mergePaceData(incoming: PaceData) {
  const d = loadPaceData()
  const more = (a: PaceProfile | undefined, b: PaceProfile) => (!a || b.words > a.words ? b : a)
  d.all = more(d.all, cleanProfile(incoming.all))
  for (const [l, p] of Object.entries(mapProfiles(incoming.langs))) d.langs[l] = more(d.langs[l], p)
  for (const [k, month] of Object.entries(incoming.months ?? {})) {
    if (!/^\d{4}-\d{2}$/.test(k)) continue
    const m = (d.months[k] ??= {})
    for (const [l, p] of Object.entries(mapProfiles(month))) m[l] = more(m[l], p)
  }
  savePaceData(d)
}

/**
 * The pace to use in one book, in seconds per KB. It starts from the personal pace (in the book's language when enough
 * was read in it; seconds per word, turned into
 * this book's bytes) and moves towards the pace measured in this book as reading time in it adds up: after
 * BOOK_TRUST_SECS both weigh the same. The two are blended on a log scale, so one noisy start can't swing it wildly.
 */
export function estimatePace({
  stats,
  totalBytes,
  words,
  lang,
}: {
  stats: Stats
  totalBytes: number
  words: number | null
  /** the book's language: its own personal pace is used when enough was read in it */
  lang?: string | null
}): number {
  const bytesPerWord = words && words > 0 && totalBytes > 0 ? totalBytes / words : null
  const prior = bytesPerWord ? ((personalSecsPerWord(lang) ?? DEFAULT_SECS_PER_WORD) * 1000) / bytesPerWord : DEFAULT_SECS_PER_KB
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
