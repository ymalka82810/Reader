import { useCallback, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { FoliateView } from 'foliate-js/view.js'
import type { Settings } from '../lib/settings'
import { createPinchPreview, wordRangeAt, type PinchPreview } from '../lib/pinchPreview'

export const MIN_FONT = 12
export const MAX_FONT = 48
/** share of the screen width, on each side, that turns the page when tapped */
const EDGE = 0.3
/** a single tap in the middle waits this long to make sure it isn't the start of a double tap */
const DOUBLE_TAP_MS = 300
/** a touch that lifts within this time without moving is a tap */
const TAP_MAX_MS = 500
/** how far (px) a finger may drift during a tap */
const TAP_SLOP = 12
/** how long a tap waits for the browser's own click before handling the touch itself */
const CLICK_WAIT_MS = 120

const isMoved = (from: { x: number; y: number }, x: number, y: number) =>
  Math.abs(x - from.x) > TAP_SLOP || Math.abs(y - from.y) > TAP_SLOP

export type Selection = { cfi: string; text: string; x: number; y: number; bottom: number }

export type TapZone = 'left' | 'right' | 'middle'

/** which part of the screen a horizontal position falls in */
export const tapZone = (x: number, width: number): TapZone =>
  x < width * EDGE ? 'left' : x > width * (1 - EDGE) ? 'right' : 'middle'

export const clampFont = (n: number) => Math.round(Math.min(MAX_FONT, Math.max(MIN_FONT, n)))

export interface BookEventsDeps {
  viewRef: MutableRefObject<FoliateView | null>
  settingsRef: MutableRefObject<Settings>
  panelRef: MutableRefObject<string | null>
  lastAnnotationClick: MutableRefObject<number>
  setSettings: Dispatch<SetStateAction<Settings>>
  setSelection: Dispatch<SetStateAction<Selection | null>>
  setUiVisible: Dispatch<SetStateAction<boolean>>
  setPanel: (p: null) => void
  /** single tap in the middle of the page */
}

/**
 * Handlers for each book section's iframe document (keys, selection, taps, pinch).
 * The returned function is stable across renders: everything it needs is read from refs
 * or from state setters, so the book-opening effect does not depend on it.
 */
export function useBookEvents(deps: BookEventsDeps) {
  const d = useRef(deps)
  useLayoutEffect(() => {
    d.current = deps
  })

  return useCallback((detail: { doc: Document; index: number }, onKey: (e: KeyboardEvent) => void) => {
    const { doc, index } = detail
    const frameLeft = () =>
      ((doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect().left ?? 0)

    doc.addEventListener('keydown', onKey)

    doc.addEventListener('selectionchange', () => {
      const { viewRef, setSelection } = d.current
      const sel = doc.getSelection()
      const text = sel?.toString().trim()
      if (!sel || sel.isCollapsed || !text) {
        // short delay so a tap on the colour bar still finds the selection
        window.setTimeout(() => {
          if (!doc.getSelection()?.toString().trim()) setSelection((cur) => (cur ? null : cur))
        }, 150)
        return
      }
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      const fr = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect()
      try {
        const cfi = viewRef.current?.getCFI(index, range)
        if (!cfi) return
        setSelection({
          cfi,
          text,
          x: (fr?.left ?? 0) + rect.left + rect.width / 2,
          y: (fr?.top ?? 0) + rect.top,
          bottom: (fr?.top ?? 0) + rect.bottom,
        })
      } catch (err) {
        console.error(err)
      }
    })

    // stop the browser's double-tap word selection on the page-turn edges
    doc.addEventListener('mousedown', (ev: MouseEvent) => {
      if (ev.detail < 2) return
      if (tapZone(frameLeft() + ev.clientX, window.innerWidth) !== 'middle') ev.preventDefault()
    })

    let middleTap: number | undefined
    const onTap = (clientX: number, detail: number) => {
      window.clearTimeout(middleTap)
      const { viewRef, panelRef, lastAnnotationClick, setSelection, setUiVisible, setPanel } = d.current
      // click position relative to the whole screen (the iframe can be offset/scrolled)
      const zone = tapZone(frameLeft() + clientX, window.innerWidth)
      // rapid taps on the edges are page turns, not word selections
      if (zone !== 'middle' && detail >= 2) {
        doc.getSelection()?.removeAllRanges()
        setSelection(null)
      }
      if (doc.getSelection()?.toString()) return
      // a tap on a highlight opens it; the overlay handler fires on the same event
      if (Date.now() - lastAnnotationClick.current < 300) return
      if (panelRef.current) {
        setPanel(null)
        return
      }
      // foliate's touchend handler re-snaps to the current page on the next animation frame;
      // turning in the same tick lets that snap fight the page-turn animation and cancel it
      // (so a tap sometimes appears to do nothing). Wait until it has run.
      const turn = zone === 'left' ? 'goLeft' : zone === 'right' ? 'goRight' : null
      if (turn) {
        setUiVisible(false)
        requestAnimationFrame(() => requestAnimationFrame(() => viewRef.current?.[turn]()))
      } else if (detail === 1) {
        middleTap = window.setTimeout(() => {
          if (!doc.getSelection()?.toString()) d.current.setUiVisible((vis) => !vis)
        }, DOUBLE_TAP_MS)
      }
    }

    // foliate's paginator cancels every touchmove, and the browser then often drops the click of
    // a tap whose finger shifted a little, so the bars would not appear. A short, still touch is
    // a tap too: if no click follows it soon, handle the touch itself.
    let touchTap: { x: number; y: number; t: number } | null = null
    let tapFallback: number | undefined
    let fallbackAt = 0
    let lastTouchTap = 0
    doc.addEventListener(
      'touchstart',
      (ev: TouchEvent) => {
        const t = ev.touches[0]
        touchTap = ev.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, t: Date.now() } : null
      },
      { passive: true },
    )
    doc.addEventListener(
      'touchmove',
      (ev: TouchEvent) => {
        const t = ev.touches[0]
        if (touchTap && (ev.touches.length !== 1 || !t || isMoved(touchTap, t.clientX, t.clientY))) touchTap = null
      },
      { passive: true },
    )
    doc.addEventListener('touchend', (ev: TouchEvent) => {
      const start = touchTap
      touchTap = null
      const t = ev.changedTouches[0]
      if (!start || !t || ev.touches.length || Date.now() - start.t > TAP_MAX_MS) return
      if (isMoved(start, t.clientX, t.clientY) || (ev.target as Element).closest?.('a')) return
      const now = Date.now()
      const detail = now - lastTouchTap < DOUBLE_TAP_MS ? 2 : 1
      lastTouchTap = now
      window.clearTimeout(tapFallback)
      tapFallback = window.setTimeout(() => {
        fallbackAt = Date.now()
        onTap(t.clientX, detail)
      }, CLICK_WAIT_MS)
    })

    doc.addEventListener('click', (ev: MouseEvent) => {
      window.clearTimeout(tapFallback)
      // a late click for a tap the fallback already handled
      if (Date.now() - fallbackAt < 600) return
      if ((ev.target as Element).closest?.('a')) return
      onTap(ev.clientX, ev.detail)
    })

    // scrolling hides the bars; pushing further once the section's end (start) is on screen moves
    // to the next (previous) section
    const atSectionEdge = (dir: 1 | -1) => {
      const r = d.current.viewRef.current?.renderer
      if (!r?.scrolled) return false
      return dir === 1 ? r.viewSize - r.end <= 2 : r.start <= 2
    }
    const turnSection = (dir: 1 | -1) => {
      const view = d.current.viewRef.current
      if (dir === 1) view?.next()
      else view?.prev()
    }
    const hideBars = () => d.current.setUiVisible((vis) => (vis ? false : vis))
    let wheelAtEdge = 0
    let wheelDir: 1 | -1 = 1
    doc.addEventListener(
      'wheel',
      (ev: WheelEvent) => {
        if (ev.deltaY === 0 || ev.ctrlKey) return
        const dir = ev.deltaY > 0 ? 1 : -1
        if (dir === 1) hideBars()
        if (dir !== wheelDir || !atSectionEdge(dir)) {
          wheelAtEdge = 0
          wheelDir = dir
          if (!atSectionEdge(dir)) return
        }
        // the first wheel notch that reaches the edge must not also turn the section
        if (wheelAtEdge === 0) wheelAtEdge = Date.now()
        else if (Date.now() - wheelAtEdge > 150) {
          wheelAtEdge = 0
          turnSection(dir)
        }
      },
      { passive: true },
    )
    let dragY: number | null = null
    let dragWasAtEnd = false
    let dragWasAtStart = false
    doc.addEventListener(
      'touchstart',
      (ev: TouchEvent) => {
        dragY = ev.touches.length === 1 ? (ev.touches[0]?.clientY ?? null) : null
        dragWasAtEnd = atSectionEdge(1)
        dragWasAtStart = atSectionEdge(-1)
      },
      { passive: true },
    )
    doc.addEventListener(
      'touchmove',
      (ev: TouchEvent) => {
        if (ev.touches.length !== 1 || dragY === null) return
        if (Math.abs((ev.touches[0]?.clientY ?? dragY) - dragY) > 10) hideBars()
      },
      { passive: true },
    )
    doc.addEventListener('touchend', (ev: TouchEvent) => {
      const endY = ev.changedTouches[0]?.clientY
      if (dragY !== null && endY !== undefined) {
        if (dragWasAtEnd && dragY - endY > 60 && atSectionEdge(1)) turnSection(1)
        else if (dragWasAtStart && endY - dragY > 60 && atSectionEdge(-1)) turnSection(-1)
      }
      dragY = null
    })

    // pinch with two fingers to shrink/grow the text, like the Aa buttons
    const pinchDist = (t: TouchEvent) => {
      const a = t.touches[0]
      const b = t.touches[1]
      return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0
    }
    let pinchStartDist: number | null = null
    let pinchStartFont = 0
    let pinchFont: number | null = null
    let preview: PinchPreview | null = null
    const endPreview = () => {
      preview?.remove()
      preview = null
    }
    doc.addEventListener(
      'touchstart',
      (ev: TouchEvent) => {
        if (ev.touches.length !== 2) return
        pinchStartDist = pinchDist(ev)
        pinchStartFont = d.current.settingsRef.current.fontSize
        pinchFont = null
        // the word between the fingers is the anchor: only it is resized live, the page changes on release
        endPreview()
        const a = ev.touches[0]
        const b = ev.touches[1]
        if (!a || !b) return
        const range = wordRangeAt(doc, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2)
        if (!range) return
        const fr = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect()
        preview = createPinchPreview(doc, range, { left: fr?.left ?? 0, top: fr?.top ?? 0 })
        preview?.update(1, pinchStartFont)
      },
      { passive: true },
    )
    doc.addEventListener(
      'touchmove',
      (ev: TouchEvent) => {
        if (ev.touches.length !== 2 || !pinchStartDist) return
        ev.preventDefault()
        // applied once on release: every settings change re-lays-out the chapter and saves
        pinchFont = clampFont(pinchStartFont * (pinchDist(ev) / pinchStartDist))
        preview?.update(pinchFont / pinchStartFont, pinchFont)
      },
      { passive: false },
    )
    const finishPinch = (ev: TouchEvent) => {
      if (ev.touches.length >= 2) return
      pinchStartDist = null
      endPreview()
      const next = pinchFont
      pinchFont = null
      if (next != null) d.current.setSettings((s) => (s.fontSize === next ? s : { ...s, fontSize: next }))
    }
    doc.addEventListener('touchend', finishPinch)
    doc.addEventListener('touchcancel', finishPinch)
  }, [])
}
