import { useCallback, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

/** how much of the strip one tap on an arrow moves it */
const STEP = 0.7

/** which physical sides of `el` have more content beyond them; scrollLeft runs from 0 to negative in right-to-left */
function hiddenSides(el: HTMLElement): { left: boolean; right: boolean } {
  const rest = el.scrollWidth - el.clientWidth
  if (rest <= 1) return { left: false, right: false }
  const rtl = getComputedStyle(el).direction === 'rtl'
  const from = Math.abs(el.scrollLeft)
  const beforeStart = from > 1
  const beyondEnd = from < rest - 1
  return rtl ? { left: beyondEnd, right: beforeStart } : { left: beforeStart, right: beyondEnd }
}

/**
 * A row of controls that scrolls sideways when it does not fit. A side with more controls beyond it fades out and shows
 * an arrow that moves the row along, so it is plain that the row goes on. `className` and the other props go on the
 * outer box (which keeps its place on screen); the controls scroll inside it.
 */
export function ScrollStrip({ children, className, style, ...rest }: { children: ReactNode; className?: string; style?: CSSProperties } & HTMLAttributes<HTMLDivElement>) {
  const track = useRef<HTMLDivElement>(null)
  const [sides, setSides] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = track.current
    if (!el) return
    const next = hiddenSides(el)
    setSides((cur) => (cur.left === next.left && cur.right === next.right ? cur : next))
  }, [])

  useEffect(() => {
    const el = track.current
    if (!el) return
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    for (const child of el.children) ro?.observe(child)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, children])

  const move = (dir: -1 | 1) => {
    const el = track.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * STEP, behavior: 'smooth' })
  }

  return (
    <div className={`scroll-strip${className ? ` ${className}` : ''}`} style={style} {...rest}>
      <div
        ref={track}
        className={'scroll-strip-track' + (sides.left ? ' fade-left' : '') + (sides.right ? ' fade-right' : '')}
        onScroll={measure}
      >
        {children}
      </div>
      {/* the controls themselves stay reachable by keyboard and screen readers; the arrows only help the eye and the finger */}
      {sides.left && (
        <button className="scroll-strip-arrow left" tabIndex={-1} aria-hidden="true" onClick={() => move(-1)}>
          ‹
        </button>
      )}
      {sides.right && (
        <button className="scroll-strip-arrow right" tabIndex={-1} aria-hidden="true" onClick={() => move(1)}>
          ›
        </button>
      )}
    </div>
  )
}
