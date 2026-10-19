import { useRef, useState } from 'react'
import type { BookMeta } from '../../lib/db'
import { t } from '../../i18n'
import { Cover } from './Cover'

// books in progress, most recently opened first; swipe sideways between them, one dot per book
export function ResumeCarousel({ books, onOpen }: { books: BookMeta[]; onOpen: (id: string) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  const touch = useRef<{ x: number; scroll: number } | null>(null)

  // distance between the start of one card and the next: card width + the gap between cards
  const step = () => {
    const el = track.current
    if (!el) return 0
    const [a, b] = [el.children[0] as HTMLElement | undefined, el.children[1] as HTMLElement | undefined]
    return a && b ? Math.abs(b.offsetLeft - a.offsetLeft) : el.clientWidth
  }

  const onScroll = () => {
    const el = track.current
    const w = step()
    if (!el || !w) return
    // scrollLeft is negative in RTL, so use its magnitude
    setIndex(Math.min(books.length - 1, Math.round(Math.abs(el.scrollLeft) / w)))
  }

  const goTo = (i: number) => {
    const el = track.current
    if (!el) return
    const dir = getComputedStyle(el).direction === 'rtl' ? -1 : 1
    el.scrollTo({ left: dir * i * step(), behavior: 'smooth' })
  }

  // swiping past either end wraps around to the other end
  const onTouchStart = (e: React.TouchEvent) => {
    const el = track.current
    const x = e.touches[0]?.clientX
    touch.current = el && x !== undefined ? { x, scroll: el.scrollLeft } : null
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const el = track.current
    const start = touch.current
    touch.current = null
    if (!el || !start || books.length < 2) return
    const endX = e.changedTouches[0]?.clientX
    if (endX === undefined) return
    const dx = endX - start.x
    if (Math.abs(dx) < 40 || Math.abs(el.scrollLeft - start.scroll) > 2) return // normal swipe, the track moved by itself
    const rtl = getComputedStyle(el).direction === 'rtl'
    // RTL: first book is on the right, so dragging right reveals the next one; LTR is the mirror
    const beyondStart = rtl ? dx < 0 : dx > 0
    if (beyondStart && index === 0) goTo(books.length - 1)
    else if (!beyondStart && index === books.length - 1) goTo(0)
  }

  return (
    <div className="resume">
      <div className="resume-track" ref={track} onScroll={onScroll} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {books.map((b) => (
          <button key={b.id} className="continue" onClick={() => onOpen(b.id)}>
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
