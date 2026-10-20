import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BookMeta } from '../../lib/db'
import { t } from '../../i18n'
import { Cover } from './Cover'

const AUTO_MS = 10_000

// books in progress, most recently opened first, each removable by hand with its ✕; swipe sideways between them (it also moves on by itself every 10 seconds), one dot per book
export function ResumeCarousel({ books, onOpen, onRemove }: { books: BookMeta[]; onOpen: (id: string) => void; onRemove: (id: string) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const settle = useRef<number | undefined>(undefined)
  // last time anything moved the carousel (user or auto), and whether a mouse is resting on it
  const lastMove = useRef(Date.now())
  const hovered = useRef(false)
  const [index, setIndex] = useState(0)

  const n = books.length
  // a closed circle: the list is repeated, the user always rests on the middle copy and is silently moved
  // back to it after each swipe, so there is no visible edge in either direction
  const loop = n > 1
  const copies = n >= 4 ? 3 : 5
  const mid = Math.floor(copies / 2)
  const items = loop ? Array.from({ length: copies }, (_, c) => books.map((b) => ({ b, c }))).flat() : books.map((b) => ({ b, c: mid }))

  // distance between the start of one card and the next: card width + the gap between cards
  const step = () => {
    const el = track.current
    if (!el) return 0
    const [a, b] = [el.children[0] as HTMLElement | undefined, el.children[1] as HTMLElement | undefined]
    return a && b ? Math.abs(b.offsetLeft - a.offsetLeft) : el.clientWidth
  }

  // scrollLeft is negative in RTL
  const dirOf = (el: HTMLElement) => (getComputedStyle(el).direction === 'rtl' ? -1 : 1)
  const slideAt = (el: HTMLElement, w: number) => Math.round(Math.abs(el.scrollLeft) / w)

  const jump = (el: HTMLElement, slide: number, w: number) => {
    el.style.scrollSnapType = 'none'
    el.scrollTo({ left: dirOf(el) * slide * w, behavior: 'auto' })
    requestAnimationFrame(() => { el.style.scrollSnapType = '' })
  }

  useLayoutEffect(() => {
    const el = track.current
    const w = step()
    if (el && w && loop) jump(el, mid * n + Math.min(index, n - 1), w)
    // only when the number of books changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n])

  useEffect(() => () => window.clearTimeout(settle.current), [])

  // auto-advance to the next book every 10 seconds; waits while the user is touching, hovering or has
  // just swiped, and does nothing when the tab is hidden or the user prefers reduced motion
  useEffect(() => {
    if (!loop || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => {
      const el = track.current
      const w = step()
      if (!el || !w || document.hidden || hovered.current) return
      if (Date.now() - lastMove.current < AUTO_MS) return
      lastMove.current = Date.now()
      el.scrollTo({ left: dirOf(el) * (slideAt(el, w) + 1) * w, behavior: 'smooth' })
    }, 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop])

  const onScroll = () => {
    const el = track.current
    const w = step()
    if (!el || !w) return
    const g = slideAt(el, w)
    setIndex(Math.min(g, items.length - 1) % n)
    lastMove.current = Date.now()
    if (!loop) return
    // once the swipe has come to rest, move back to the equivalent card on the middle copy
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      const cur = slideAt(el, w)
      if (cur < mid * n || cur >= (mid + 1) * n) jump(el, mid * n + (cur % n), w)
    }, 150)
  }

  const goTo = (i: number) => {
    const el = track.current
    const w = step()
    if (!el || !w) return
    const g = slideAt(el, w)
    // pick the copy of book i closest to where we are, so the dot always takes the shortest way round
    let target = i
    for (let c = 0; c < copies; c++) if (Math.abs(c * n + i - g) < Math.abs(target - g)) target = c * n + i
    lastMove.current = Date.now()
    el.scrollTo({ left: dirOf(el) * target * w, behavior: 'smooth' })
  }

  return (
    <div
      className="resume"
      onMouseEnter={() => { hovered.current = true }}
      onMouseLeave={() => { hovered.current = false; lastMove.current = Date.now() }}
      onPointerDown={() => { lastMove.current = Date.now() }}
      onTouchStart={() => { lastMove.current = Date.now() }}
    >
      <div className="resume-track" ref={track} onScroll={onScroll}>
        {items.map(({ b, c }) => (
          <div key={`${c}-${b.id}`} className="resume-item" {...(c !== mid ? { 'aria-hidden': true, inert: true } : {})}>
          <button className="continue" onClick={() => onOpen(b.id)}>
            <Cover book={b} />
            <span className="continue-info">
              <small>{t('lib.resume')}</small>
              <strong>{b.title}</strong>
              {b.author && <small>{b.author}</small>}
              <span className="continue-progress">
                <progress value={b.fraction} max={1} aria-label={t('book.percentRead', { pct: Math.round((b.fraction ?? 0) * 100) })} />
                <small aria-hidden="true">{Math.round((b.fraction ?? 0) * 100)}%</small>
              </span>
            </span>
            <span className="continue-cta">{t('lib.continue')}</span>
          </button>
          <button className="resume-remove" aria-label={t('lib.resumeRemove', { title: b.title })} title={t('lib.resumeRemove', { title: b.title })} onClick={() => onRemove(b.id)}>✕</button>
          </div>
        ))}
      </div>
      {books.length > 1 && (
        <div className="resume-dots">
          {books.map((b, i) => (
            <button
              key={b.id}
              className={i === index ? 'on' : ''}
              aria-label={b.title}
              aria-current={i === index}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
