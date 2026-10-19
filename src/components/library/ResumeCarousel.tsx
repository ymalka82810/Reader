import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BookMeta } from '../../lib/db'
import { t } from '../../i18n'
import { Cover } from './Cover'

// books in progress, most recently opened first; swipe sideways between them, one dot per book
export function ResumeCarousel({ books, onOpen }: { books: BookMeta[]; onOpen: (id: string) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const settle = useRef<number | undefined>(undefined)
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

  const onScroll = () => {
    const el = track.current
    const w = step()
    if (!el || !w) return
    const g = slideAt(el, w)
    setIndex(Math.min(g, items.length - 1) % n)
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
    el.scrollTo({ left: dirOf(el) * target * w, behavior: 'smooth' })
  }

  return (
    <div className="resume">
      <div className="resume-track" ref={track} onScroll={onScroll}>
        {items.map(({ b, c }) => (
          <button
            key={`${c}-${b.id}`}
            className="continue"
            onClick={() => onOpen(b.id)}
            {...(c !== mid ? { 'aria-hidden': true, tabIndex: -1 } : {})}
          >
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
