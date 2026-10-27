import { useEffect, useMemo, useRef } from 'react'
import { getProgress, updateProgress } from '../lib/db'
import type { ReadRanges } from '../lib/readCover'
import { addStats, type Stats } from '../lib/stats'
import { addReadingTime } from '../lib/readingLog'
import { createReadingTracker, TICK_MS, type RelocateDetail } from './readingTracker'
import { useLatest } from './useLatest'

type Impl = { markActive: () => void; relocate: (d: RelocateDetail) => void; markRead: (a: number, b: number) => void; readRanges: () => ReadRanges }
const IDLE: Impl = { markActive: () => {}, relocate: () => {}, markRead: () => {}, readRanges: () => [] }

/**
 * Saves the reading position (debounced) and reading-speed stats for one book, and hands every saved stretch of
 * reading to `onRead` (the personal reading pace learns from it).
 * `markActive`, `relocate` and `session` are stable, so callers can use them inside long-lived listeners.
 */
export function useReadingTracker(
  id: string,
  onRead: (secs: number, frac: number) => void = () => {},
  opts: { pageFraction?: () => number; onJump?: (fraction: number) => void } = {},
) {
  const read = useLatest(onRead)
  const options = useLatest(opts)
  /** reading saved since the book was opened, so the pace estimate can follow it without re-reading storage */
  const session = useRef<Stats>({ secs: 0, frac: 0 })
  const impl = useRef<Impl>(IDLE)

  useEffect(() => {
    session.current = { secs: 0, frac: 0 }
    const tracker = createReadingTracker({
      now: Date.now,
      isHidden: () => document.hidden,
      saveProgress: (cfi, fraction, ranges) => updateProgress(id, cfi, fraction, ranges),
      pageFraction: () => options.current.pageFraction?.() ?? 0,
      onJump: (f) => options.current.onJump?.(f),
      saveStats: (secs, frac) => {
        addStats(id, secs, frac)
        addReadingTime(secs)
        session.current = { secs: session.current.secs + secs, frac: session.current.frac + frac }
        read.current(secs, frac)
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

    impl.current = { markActive: tracker.markActive, relocate: tracker.relocate, markRead: tracker.markRead, readRanges: tracker.readRanges }
    // what was read before; a book read before the stretches were kept counts as read up to where it stood
    let alive = true
    void getProgress(id)
      .then((p) => alive && p && tracker.seed(p.read ?? (p.fraction > 0 ? [[0, p.fraction]] : [])))
      .catch(console.error)

    return () => {
      alive = false
      impl.current = IDLE
      window.clearInterval(statsTimer)
      tracker.flushStats()
      tracker.flushProgress() // don't lose the last position if the book is closed within the debounce window
      window.removeEventListener('pagehide', tracker.flushProgress)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [id, read, options])

  return useMemo(
    () => ({
      markActive: () => impl.current.markActive(),
      relocate: (d: RelocateDetail) => impl.current.relocate(d),
      session: () => session.current,
      markRead: (a: number, b: number) => impl.current.markRead(a, b),
      readRanges: () => impl.current.readRanges(),
    }),
    [],
  )
}
