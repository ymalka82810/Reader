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

export interface RelocateDetail {
  fraction?: number
  cfi?: string
}

export interface TrackerDeps {
  now: () => number
  isHidden: () => boolean
  saveProgress: (cfi: string, fraction: number) => void
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
  let pendingFrac = 0
  let pendingSecs = 0
  let ticks = 0
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
      if (lastFraction !== null && f > lastFraction && f - lastFraction < MAX_READ_STEP) {
        pendingFrac += f - lastFraction
        const gap = now - lastActive
        if (gap > 0 && gap < ACTIVE_MS) {
          turns.push(gap)
          if (turns.length > TURNS_KEPT) turns.shift()
        }
      }
      lastActive = now
      lastFraction = f
      deps.clearTimer(saveTimer)
      const cfi = d.cfi
      if (cfi) {
        pendingSave = () => deps.saveProgress(cfi, f)
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
  }
}
