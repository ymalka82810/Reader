import { useEffect, type MutableRefObject } from 'react'
import type { FoliateView } from 'foliate-js/view.js'
import { spreadAttrs, type OrientationLock, type Spread } from '../lib/viewModes'

type LockableOrientation = ScreenOrientation & {
  lock?: (o: 'portrait' | 'landscape') => Promise<void>
}

const orientation = () => (typeof screen === 'undefined' ? undefined : (screen.orientation as LockableOrientation | undefined))

const inFullscreen = () => !!document.fullscreenElement
const enterFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {})
const leaveFullscreen = () => (inFullscreen() ? document.exitFullscreen().catch(() => {}) : undefined)

/**
 * Applies the view modes that live outside the book text: the number of columns, the screen
 * orientation lock and full screen for distraction-free reading. All are undone when the reader closes.
 */
export function useViewModes({
  viewRef,
  ready,
  spread,
  focus,
  lock,
  onLayout,
  flash,
}: {
  viewRef: MutableRefObject<FoliateView | null>
  /** the book is open */
  ready: boolean
  spread: Spread
  focus: boolean
  lock: OrientationLock
  /** the page layout changed, so page counts must be measured again */
  onLayout: () => void
  flash: (msg: string) => void
}) {
  useEffect(() => {
    const r = viewRef.current?.renderer
    if (!ready || !r) return
    const a = spreadAttrs(spread)
    r.setAttribute?.('max-column-count', a['max-column-count'])
    r.setAttribute?.('max-inline-size', a['max-inline-size']) // last: it re-renders the pages
    onLayout()
  }, [viewRef, ready, spread, onLayout])

  // full screen is only a bonus of focus mode: browsers refuse it without a tap, and then the bars still stay out of the way
  useEffect(() => {
    if (focus) void enterFullscreen()
    else void leaveFullscreen()
  }, [focus])

  useEffect(() => {
    const o = orientation()
    if (lock === 'free' || !o?.lock) {
      if (lock !== 'free') flash('נעילת כיוון אינה נתמכת במכשיר זה')
      return
    }
    let cancelled = false
    const apply = () => o.lock?.(lock)
    // Chrome in a normal tab only locks while in full screen, so try that when the plain lock is refused
    apply()?.catch(async () => {
      await enterFullscreen()
      try {
        await apply()
      } catch {
        if (!cancelled) flash('לא ניתן לנעול כיוון — נסה מצב מסך מלא או התקנה כאפליקציה')
      }
    })
    return () => {
      cancelled = true
      o.unlock()
    }
  }, [lock, flash])

  useEffect(
    () => () => {
      void leaveFullscreen()
    },
    [],
  )
}
