/** how long after the last page turn / key press the reader still counts as actively reading */
export const ACTIVE_MS = 90_000
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
      lastActive = deps.now()
      if (lastFraction !== null && f > lastFraction && f - lastFraction < MAX_READ_STEP) pendingFrac += f - lastFraction
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
      if (!deps.isHidden() && deps.now() - lastActive < ACTIVE_MS) pendingSecs += TICK_MS / 1000
      if (++ticks % FLUSH_TICKS === 0) flushStats()
    },
    flushProgress,
    flushStats,
  }
}
