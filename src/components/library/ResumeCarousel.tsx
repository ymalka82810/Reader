import { useRef, useState } from 'react'
import type { BookMeta } from '../../lib/db'
import { t } from '../../i18n'
import { Cover } from './Cover'

// books in progress, most recently opened first; swipe sideways between them, one dot per book
export function ResumeCarousel({ books, onOpen }: { books: BookMeta[]; onOpen: (id: string) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  const onScroll = () => {
    const el = track.current
    if (!el || !el.clientWidth) return
    // scrollLeft is negative in RTL, so use its magnitude
    setIndex(Math.min(books.length - 1, Math.round(Math.abs(el.scrollLeft) / el.clientWidth)))
  }

  const goTo = (i: number) => {
    const el = track.current
    if (!el) return
    const dir = getComputedStyle(el).direction === 'rtl' ? -1 : 1
    el.scrollTo({ left: dir * i * el.clientWidth, behavior: 'smooth' })
  }

  return (
    <div className="resume">
      <div className="resume-track" ref={track} onScroll={onScroll}>
        {books.map((b) => (
          <button key={b.id} className="continue" onClick={() => onOpen(b.id)}>
            <Cover book={b} />
            <span className="continue-info">
              <small>{t('lib.resume')}</small>
              <strong>{b.title}</strong>
              {b.author && <small>{b.author}</small>}
              <progress value={b.fraction} max={1} aria-label={t('book.percentRead', { pct: Math.round((b.fraction ?? 0) * 100) })} />
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
