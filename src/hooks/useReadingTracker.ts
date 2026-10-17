import { useEffect, useMemo, useRef } from 'react'
import { updateProgress } from '../lib/db'
import { addStats } from '../lib/stats'
import { addReadingTime } from '../lib/readingLog'
import { createReadingTracker, TICK_MS, type RelocateDetail } from './readingTracker'

/**
 * Saves the reading position (debounced) and reading-speed stats for one book.
 * `markActive` and `relocate` are stable, so callers can use them inside long-lived listeners.
 */
export function useReadingTracker(id: string) {
  const impl = useRef<{ markActive: () => void; relocate: (d: RelocateDetail) => void }>({
    markActive: () => {},
    relocate: () => {},
  })

  useEffect(() => {
    const tracker = createReadingTracker({
      now: Date.now,
      isHidden: () => document.hidden,
      saveProgress: (cfi, fraction) => updateProgress(id, cfi, fraction),
      saveStats: (secs, frac) => {
        addStats(id, secs, frac)
        addReadingTime(secs)
      },
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (h) => window.clearTimeout(h),
    })
    // tick every 5s to measure activity, but write to storage only every 30s
    const statsTimer = window.setInterval(tracker.tick, TICK_MS)

    // iOS and background-discarded tabs often skip pagehide, so also flush when the tab is hidden
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        tracker.flushProgress()
        tracker.flushStats()
      }
    }
    window.addEventListener('pagehide', tracker.flushProgress)
    document.addEventListener('visibilitychange', onVisibility)

    impl.current = { markActive: tracker.markActive, relocate: tracker.relocate }

    return () => {
      impl.current = { markActive: () => {}, relocate: () => {} }
      window.clearInterval(statsTimer)
      tracker.flushStats()
      tracker.flushProgress() // don't lose the last position if the book is closed within the debounce window
      window.removeEventListener('pagehide', tracker.flushProgress)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [id])

  return useMemo(
    () => ({
      markActive: () => impl.current.markActive(),
      relocate: (d: RelocateDetail) => impl.current.relocate(d),
    }),
    [],
  )
}
