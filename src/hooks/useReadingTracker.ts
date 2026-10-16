import { useEffect, useMemo, useRef } from 'react'
import { updateProgress } from '../lib/db'
import { addStats } from '../lib/stats'

/** how long after the last page turn / key press the reader still counts as actively reading */
const ACTIVE_MS = 90_000
const TICK_MS = 5000
/** storage is written every this many ticks (30s) */
const FLUSH_TICKS = 6
const SAVE_DELAY_MS = 800
/** forward steps larger than this are jumps (slider / TOC / search), not reading */
const MAX_READ_STEP = 0.05

/**
 * Saves the reading position (debounced) and reading-speed stats for one book.
 * `markActive` and `relocate` are stable, so callers can use them inside long-lived listeners.
 */
export function useReadingTracker(id: string) {
  const impl = useRef({ markActive: () => {}, relocate: (_d: any) => {} })

  useEffect(() => {
    let saveTimer: number | undefined
    let pendingSave: (() => void) | undefined
    const flushProgress = () => {
      window.clearTimeout(saveTimer)
      pendingSave?.()
      pendingSave = undefined
    }

    // count active seconds and forward progress
    let lastActive = Date.now()
    let lastFraction: number | null = null
    let pendingFrac = 0
    let pendingSecs = 0
    let ticks = 0
    const flushStats = () => {
      addStats(id, pendingSecs, pendingFrac)
      pendingSecs = 0
      pendingFrac = 0
    }
    // tick every 5s to measure activity, but write to storage only every 30s
    const statsTimer = window.setInterval(() => {
      if (!document.hidden && Date.now() - lastActive < ACTIVE_MS) pendingSecs += TICK_MS / 1000
      if (++ticks % FLUSH_TICKS === 0) flushStats()
    }, TICK_MS)

    // iOS and background-discarded tabs often skip pagehide, so also flush when the tab is hidden
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress()
        flushStats()
      }
    }
    window.addEventListener('pagehide', flushProgress)
    document.addEventListener('visibilitychange', onVisibility)

    impl.current = {
      markActive: () => {
        lastActive = Date.now()
      },
      relocate: (d) => {
        const f: number = d.fraction ?? 0
        lastActive = Date.now()
        if (lastFraction !== null && f > lastFraction && f - lastFraction < MAX_READ_STEP) pendingFrac += f - lastFraction
        lastFraction = f
        window.clearTimeout(saveTimer)
        if (d.cfi) {
          pendingSave = () => updateProgress(id, d.cfi, d.fraction ?? 0)
          saveTimer = window.setTimeout(flushProgress, SAVE_DELAY_MS)
        }
      },
    }

    return () => {
      impl.current = { markActive: () => {}, relocate: () => {} }
      window.clearInterval(statsTimer)
      flushStats()
      flushProgress() // don't lose the last position if the book is closed within the debounce window
      window.removeEventListener('pagehide', flushProgress)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [id])

  return useMemo(
    () => ({
      markActive: () => impl.current.markActive(),
      relocate: (d: any) => impl.current.relocate(d),
    }),
    [],
  )
}
