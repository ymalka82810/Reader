import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import type { FoliateRelocateDetail, FoliateView } from 'foliate-js/view.js'
import { clampPace, linearSizes, loadPace, PACE_STEP, paceFromStats, savePace, screenSecs } from '../lib/pace'
import type { Flow } from '../lib/settings'
import { loadStats } from '../lib/stats'

/** foliate reports the scrolled position only 250 ms after scrolling stops, so the steady scroll
 *  rests this briefly every PULSE_MS (and then catches up) to keep progress and stats current */
const PULSE_MS = 4000
const PULSE_GAP_MS = 320
/** after the reader scrolls by hand, leave the page alone this long */
const USER_HOLD_MS = 1500
/** keeps the reading tracker counting on long auto-paced pages (it stops after 90 s without a page turn) */
const ACTIVE_PING_MS = 30_000

interface Deps {
  id: string
  viewRef: MutableRefObject<FoliateView | null>
  lastDetail: MutableRefObject<FoliateRelocateDetail | null>
  flow: Flow
  /** a panel, selection or the bars are up: hold still until they are gone */
  paused: boolean
  markActive: () => void
}

/** the element that scrolls the book in scrolled mode; it sits in foliate's closed shadow root,
 *  so it is found by walking up from the section's iframe */
function findScroller(view: FoliateView): HTMLElement | null {
  const doc = view.renderer.getContents?.()[0]?.doc
  let el = (doc?.defaultView?.frameElement as HTMLElement | null) ?? null
  while (el) {
    const s = getComputedStyle(el)
    if (/auto|scroll/.test(s.overflowY + s.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth))
      return el
    el = el.parentElement
  }
  return null
}

/**
 * Moves the text by itself at the reader's own pace: a steady scroll in scrolled mode, timed page
 * turns in paginated mode. The pace comes from this book's reading stats (or the last pace used
 * anywhere) and the faster/slower controls adjust it.
 */
export function useAutoRead({ id, viewRef, lastDetail, flow, paused, markActive }: Deps) {
  const [active, setActive] = useState(false)
  /** seconds per KB of source */
  const [pace, setPace] = useState<number | null>(null)
  const [secsPerScreen, setSecsPerScreen] = useState<number | null>(null)

  const toggle = useCallback(async () => {
    if (active) return setActive(false)
    const view = viewRef.current
    if (!view) return
    const total = linearSizes(view.book.sections).reduce((a, b) => a + b, 0)
    setPace(paceFromStats(await loadStats(id), total) ?? loadPace())
    setActive(true)
  }, [active, id, viewRef])

  const adjust = useCallback(
    (faster: boolean) => setPace((p) => (p === null ? p : clampPace(faster ? p / PACE_STEP : p * PACE_STEP))),
    [],
  )

  // the pace in use becomes the starting point for books without stats of their own
  useEffect(() => {
    if (pace !== null) savePace(pace)
  }, [pace])

  useEffect(() => {
    const view = viewRef.current
    if (!active || paused || pace === null || !view) return
    const r = view.renderer
    let cancelled = false
    const ping = window.setInterval(markActive, ACTIVE_PING_MS)

    /** seconds the current screen should stay up */
    const current = () => {
      const bytes = linearSizes(view.book.sections)[lastDetail.current?.section?.current ?? -1] ?? 0
      const screens = r.scrolled ? r.viewSize / r.size : r.pages - 2
      const secs = screenSecs(pace, bytes, screens)
      setSecsPerScreen(Math.round(secs))
      return secs
    }

    if (!r.scrolled) {
      let timer: number | undefined
      const schedule = () => {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          if (cancelled) return
          if (r.atEnd) return setActive(false)
          view.next().then(() => !cancelled && schedule(), console.error)
        }, current() * 1000)
      }
      // a manual page turn (or a re-layout) restarts the clock for the new page
      const onVisible = () => !document.hidden && schedule()
      schedule()
      view.addEventListener('relocate', schedule)
      document.addEventListener('visibilitychange', onVisible)
      return () => {
        cancelled = true
        window.clearTimeout(timer)
        window.clearInterval(ping)
        view.removeEventListener('relocate', schedule)
        document.removeEventListener('visibilitychange', onVisible)
      }
    }

    let scroller: HTMLElement | null = null
    let section = lastDetail.current?.section?.current
    let speed = r.size / current() // px per second
    /** float position we are moving to, and the (rounded) value the browser actually stored */
    let pos: number | null = null
    let written: number | null = null
    let last = performance.now()
    let pulseAt = last + PULSE_MS
    let holdUntil = 0
    let debt = 0
    let busy = false
    let waitTimer: number | undefined

    const onRelocate = () => {
      const s = lastDetail.current?.section?.current
      if (s !== section) {
        section = s
        scroller = null
        pos = written = null
      }
      speed = r.size / current()
    }
    view.addEventListener('relocate', onRelocate)

    const toNextSection = () => {
      if (r.atEnd) return setActive(false)
      busy = true
      // the last lines have only just come into view: give them time before the section changes
      waitTimer = window.setTimeout(async () => {
        if (cancelled) return
        await view.next().catch(console.error)
        scroller = null
        pos = written = null
        debt = 0
        busy = false
      }, (r.size / speed / 2) * 1000)
    }

    let raf = 0
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, (t - last) / 1000)
      last = t
      if (busy) return
      scroller ??= findScroller(view)
      if (!scroller) return
      const prop = r.scrollProp
      // vertical writing scrolls leftwards, to negative scrollLeft
      const sign = prop === 'scrollLeft' ? -1 : 1
      const cur = Math.abs(scroller[prop])
      if (written !== null && Math.abs(cur - written) > 1) {
        holdUntil = t + USER_HOLD_MS
        debt = 0
      }
      if (t < holdUntil) {
        pos = written = cur
        return
      }
      pos ??= cur
      const step = speed * dt
      if (t >= pulseAt) {
        if (t < pulseAt + PULSE_GAP_MS) {
          debt += step
          return
        }
        pulseAt = t + PULSE_MS
      }
      if (r.viewSize - r.end <= 2) return toNextSection()
      const extra = Math.min(debt, step / 2)
      debt -= extra
      pos += step + extra
      scroller[prop] = sign * pos
      written = Math.abs(scroller[prop])
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.clearTimeout(waitTimer)
      window.clearInterval(ping)
      view.removeEventListener('relocate', onRelocate)
    }
  }, [active, paused, pace, flow, viewRef, lastDetail, markActive])

  return { active, toggle, adjust, secsPerScreen: active ? secsPerScreen : null }
}
