import { addRange, coveredBefore, unionRanges, type ReadRanges } from '../lib/readCover'

/** how long after the last page turn / key press the reader still counts as actively reading */
export const ACTIVE_MS = 90_000
/** once the reader's own page time is known, idle time counts only up to a few page times, but never less than this */
export const MIN_ACTIVE_MS = 45_000
/** page turns remembered for the reader's page time, and how many are needed before it is used */
const TURNS_KEPT = 9
const TURNS_NEEDED = 3
export const TICK_MS = 5000
/** storage is written every this many ticks (30s) */
export const FLUSH_TICKS = 6
export const SAVE_DELAY_MS = 800
/** forward steps larger than this are jumps (slider / TOC / search), not reading */
export const MAX_READ_STEP = 0.05
/** a stretch counts as read only if at least this long was spent on each of its pages (flicking through is not reading) */
export const MIN_PAGE_MS = 1500
/** a page's share of the book when the page count isn't known yet */
const DEFAULT_PAGE = 0.003
/** a jump forward asks "did you read up to here?" when more than this of the book before the landing point is unread */
const ASK_UNREAD = 0.1


export interface RelocateDetail {
  fraction?: number
  cfi?: string
}

export interface TrackerDeps {
  now: () => number
  isHidden: () => boolean
  saveProgress: (cfi: string, fraction: number, read: ReadRanges) => void
  /** a page's share of the book (1 / pages), 0 when not known yet */
  pageFraction?: () => number
  /** a jump forward landed where much of the book before it was not read */
  onJump?: (fraction: number) => void
  saveStats: (seconds: number, fraction: number) => void
  setTimer: (fn: () => void, ms: number) => number
  clearTimer: (handle: number | undefined) => void
}

/** Pure reading-tracking logic (no timers or DOM of its own) so it can be tested with a fake clock. */
export function createReadingTracker(deps: TrackerDeps) {
  let saveTimer: number | undefined
  let pendingSave: (() => void) | undefined
  let lastActive = deps.now()
  let lastFraction: number | null = null
  let lastCfi = ''
  /** when the position last changed */
  let lastMoved = deps.now()
  let pendingFrac = 0
  let pendingSecs = 0
  let ticks = 0
  /** the stretches read so far (seeded from storage when the book opens) */
  let read: ReadRanges = []
  /** where the stretch being read now started: reading since then is credited once enough time was spent on it */
  let anchor: { f: number; t: number } | null = null
  /** recent times between two reading page turns */
  const turns: number[] = []
  /** how long after the last activity the reader still counts as reading: three of their own page times, within bounds */
  const activeMs = () => {
    if (turns.length < TURNS_NEEDED) return ACTIVE_MS
    const median = [...turns].sort((a, b) => a - b)[turns.length >> 1]!
    return Math.min(ACTIVE_MS, Math.max(MIN_ACTIVE_MS, 3 * median))
  }

  const flushProgress = () => {
    deps.clearTimer(saveTimer)
    pendingSave?.()
    pendingSave = undefined
  }
  const flushStats = () => {
    deps.saveStats(pendingSecs, pendingFrac)
    pendingSecs = 0
    pendingFrac = 0
  }

  return {
    markActive() {
      lastActive = deps.now()
    },
    relocate(d: RelocateDetail) {
      const f = d.fraction ?? 0
      const now = deps.now()
      const step = lastFraction === null ? 0 : f - lastFraction
      if (lastFraction !== null && step > 0 && step < MAX_READ_STEP) {
        // reading forward: the stretch since the anchor is read once it had its pages' worth of time
        if (!anchor) anchor = { f: lastFraction, t: lastMoved }
        const page = deps.pageFraction?.() || DEFAULT_PAGE
        const len = f - anchor.f
        if (now - anchor.t >= MIN_PAGE_MS * (len / page)) {
          read = addRange(read, anchor.f, f)
          anchor = { f, t: now }
        } else if (len >= MAX_READ_STEP) anchor = { f, t: now } // flicked through a whole stretch: not read, start again here
      } else if (step < 0 || step >= MAX_READ_STEP) {
        anchor = null
        // a jump forward over a part not read yet: ask whether it was read before (another device, a paper copy…)
        if (lastFraction !== null && step >= MAX_READ_STEP && f - coveredBefore(read, f) > ASK_UNREAD) deps.onJump?.(f)
      }
      if (lastFraction !== null && step > 0 && step < MAX_READ_STEP) {
        pendingFrac += f - lastFraction
        const gap = now - lastActive
        if (gap > 0 && gap < ACTIVE_MS) {
          turns.push(gap)
          if (turns.length > TURNS_KEPT) turns.shift()
        }
      }
      lastActive = now
      if (f !== lastFraction) lastMoved = now
      lastFraction = f
      deps.clearTimer(saveTimer)
      const cfi = d.cfi
      if (cfi) lastCfi = cfi
      if (cfi) {
        pendingSave = () => deps.saveProgress(cfi, f, read)
        saveTimer = deps.setTimer(flushProgress, SAVE_DELAY_MS)
      }
    },
    /** called every TICK_MS: counts active seconds and writes stats every FLUSH_TICKS */
    tick() {
      if (!deps.isHidden() && deps.now() - lastActive < activeMs()) pendingSecs += TICK_MS / 1000
      if (++ticks % FLUSH_TICKS === 0) flushStats()
    },
    flushProgress,
    flushStats,
    /** the stretches read when the book was opened */
    seed(ranges: ReadRanges) {
      read = unionRanges(read, ranges) ?? []
    },
    /** the user says [from, to] was read (before, elsewhere): it counts as read and is saved with the position */
    markRead(from: number, to: number) {
      read = addRange(read, from, to)
      if (lastFraction !== null && !pendingSave && lastCfi) {
        const cfi = lastCfi
        const f = lastFraction
        pendingSave = () => deps.saveProgress(cfi, f, read)
      }
      flushProgress()
    },
    /** the stretches read so far, this session included */
    readRanges: () => read,
  }
}
