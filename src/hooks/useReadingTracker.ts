import { useEffect, useMemo, useRef } from 'react'
import { updateProgress } from '../lib/db'
import { learnPace } from '../lib/pace'
import { addStats, type Stats } from '../lib/stats'
import { addReadingTime } from '../lib/readingLog'
import { createReadingTracker, TICK_MS, type RelocateDetail } from './readingTracker'
import { useLatest } from './useLatest'

/**
 * Saves the reading position (debounced) and reading-speed stats for one book, and teaches the personal reading pace
 * (lib/pace) the words read, when the book's word count is known (`wordsInBook`).
 * `markActive`, `relocate` and `session` are stable, so callers can use them inside long-lived listeners.
 */
export function useReadingTracker(id: string, wordsInBook: () => number | null = () => null) {
  const words = useLatest(wordsInBook)
  /** reading saved since the book was opened, so the pace estimate can follow it without re-reading storage */
  const session = useRef<Stats>({ secs: 0, frac: 0 })
  const impl = useRef<{ markActive: () => void; relocate: (d: RelocateDetail) => void }>({
    markActive: () => {},
    relocate: () => {},
  })

  useEffect(() => {
    session.current = { secs: 0, frac: 0 }
    const tracker = createReadingTracker({
      now: Date.now,
      isHidden: () => document.hidden,
      saveProgress: (cfi, fraction) => updateProgress(id, cfi, fraction),
      saveStats: (secs, frac) => {
        addStats(id, secs, frac)
        addReadingTime(secs)
        session.current = { secs: session.current.secs + secs, frac: session.current.frac + frac }
        const w = words.current()
        if (w) learnPace(secs, frac * w)
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
  }, [id, words])

  return useMemo(
    () => ({
      markActive: () => impl.current.markActive(),
      relocate: (d: RelocateDetail) => impl.current.relocate(d),
      session: () => session.current,
    }),
    [],
  )
}
