import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '../Dialog'
import { Stars } from '../Stars'
import { localeTag, t } from '../../i18n'
import type { BookMeta } from '../../lib/db'
import { finishedInYear, finishedYears } from '../../lib/finishedYear'
import { formatMinutes, loadAllStats, type Stats } from '../../lib/stats'
import { shownName } from '../../lib/bookName'

const monthName = (year: number, month: number) => new Date(year, month, 1).toLocaleDateString(localeTag(), { month: 'long' })

/** "the books I finished this year": by month, with the rating, and the year's hours and words */
export function FinishedYearDialog({ books, onOpen, onClose }: { books: BookMeta[]; onOpen: (id: string) => void; onClose: () => void }) {
  const [stats, setStats] = useState<Map<string, Stats>>()
  useEffect(() => {
    let alive = true
    void loadAllStats().then((s) => alive && setStats(s))
    return () => {
      alive = false
    }
  }, [])
  const [thisYear] = useState(() => new Date().getFullYear())
  // this year is always offered, even before its first finished book
  const years = useMemo(() => [...new Set([thisYear, ...finishedYears(books)])].sort((a, b) => b - a), [books, thisYear])
  const [year, setYear] = useState(thisYear)
  const data = useMemo(() => stats && finishedInYear(books, stats, year), [books, stats, year])
  const at = years.indexOf(year)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <Dialog
        className="modal finished-year"
        role="dialog"
        aria-modal="true"
        aria-label={t('finished.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="finished-head">
          <button className="quiet" aria-label={t('finished.older')} disabled={at >= years.length - 1} onClick={() => setYear(years[at + 1]!)}>
            ‹
          </button>
          <h2>{year === thisYear ? t('finished.title') : t('finished.titleYear', { year: String(year) })}</h2>
          <button className="quiet" aria-label={t('finished.newer')} disabled={at <= 0} onClick={() => setYear(years[at - 1]!)}>
            ›
          </button>
        </div>
        {!data ? (
          <p>{t('common.loading')}</p>
        ) : !data.count ? (
          <p className="muted">{t('finished.none')}</p>
        ) : (
          <>
            <div className="goals-stats">
              <div>
                <strong>{data.count}</strong>
                <small>{t('finished.books', { n: data.count })}</small>
              </div>
              <div>
                <strong>{formatMinutes(Math.round(data.secs / 60))}</strong>
                <small>{t('finished.time')}</small>
              </div>
              <div>
                <strong>{data.words ? data.words.toLocaleString(localeTag()) : '—'}</strong>
                <small>{t('finished.words')}</small>
              </div>
            </div>
            {data.avgRating > 0 && <small className="muted">{t('finished.avg', { n: (Math.round(data.avgRating * 10) / 10).toLocaleString(localeTag()) })}</small>}
            {data.months.map((m) => (
              <section key={m.month} className="finished-month">
                <h3>
                  {monthName(year, m.month)} <small className="muted">· {m.books.length}</small>
                </h3>
                <ul>
                  {m.books.map(({ book, secs }) => (
                    <li key={book.id}>
                      <button className="finished-book" onClick={() => onOpen(book.id)}>
                        <span className="finished-name">
                          {shownName(book.title)}
                          {book.author && <small className="muted"> · {book.author}</small>}
                        </span>
                        <span className="finished-meta">
                          {book.rating ? <Stars value={book.rating} small /> : null}
                          {secs >= 60 && <small className="muted">{formatMinutes(Math.round(secs / 60))}</small>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onClose} autoFocus>
            {t('common.close')}
          </button>
        </div>
      </Dialog>
    </div>
  )
}
