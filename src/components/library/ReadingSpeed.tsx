import { useEffect, useState } from 'react'
import { localeTag, t } from '../../i18n'
import { listBooks } from '../../lib/db'
import { bookSpeeds, loadPaceData, monthlyWpm, personalSecsPerWord, wpm, wpmByLanguage } from '../../lib/pace'
import { formatMinutes, loadAllStats } from '../../lib/stats'
import { shownName } from '../../lib/bookName'

/** books shown on each side (faster / slower than usual), and how far from usual a book must be to count */
const BOOKS_SHOWN = 3
const NOTABLE = 0.1
/** a typical novel, for the "a book takes you…" figure */
const SAMPLE_BOOK_WORDS = 100_000

type BookSpeed = ReturnType<typeof bookSpeeds>[number]

const langName = (code: string) => {
  try {
    return new Intl.DisplayNames([localeTag()], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

const percent = (ratio: number) => `${ratio >= 1 ? '+' : '−'}${Math.round(Math.abs(ratio - 1) * 100)}%`

/** "my reading speed": words a minute now, by month, by language, and the books read faster or slower than usual */
export function ReadingSpeed() {
  const [data] = useState(loadPaceData)
  const secsPerWord = personalSecsPerWord(null, data)
  const usual = secsPerWord ? wpm(secsPerWord) : null
  const [books, setBooks] = useState<BookSpeed[]>()

  useEffect(() => {
    if (!usual) return
    let alive = true
    void Promise.all([listBooks(), loadAllStats()]).then(([list, stats]) => alive && setBooks(bookSpeeds(list, stats, usual)))
    return () => {
      alive = false
    }
  }, [usual])

  if (!usual) {
    return (
      <>
        <h3>{t('speed.title')}</h3>
        <small className="goals-note">{t('speed.none')}</small>
      </>
    )
  }

  const months = monthlyWpm(data)
  const thisMonth = months[months.length - 1]!.wpm
  const max = Math.max(...months.map((m) => m.wpm ?? 0), 1) * 1.2
  const langs = wpmByLanguage(data)
  const faster = (books ?? []).filter((b) => b.ratio >= 1 + NOTABLE).slice(0, BOOKS_SHOWN)
  const slower = (books ?? []).filter((b) => b.ratio <= 1 - NOTABLE).slice(0, BOOKS_SHOWN)
  const row = (b: BookSpeed) => (
    <li key={b.id}>
      <span className="speed-name">{shownName(b.title)}</span>
      <span>
        {t('speed.wpm', { n: b.wpm })} <small>({percent(b.ratio)})</small>
      </span>
    </li>
  )

  return (
    <>
      <h3>{t('speed.title')}</h3>
      <div className="goals-stats">
        <div>
          <strong>{usual}</strong>
          <small>{t('speed.now')}</small>
        </div>
        <div>
          <strong>{thisMonth ?? '—'}</strong>
          <small>{t('speed.thisMonth')}</small>
        </div>
        <div>
          <strong>{formatMinutes(Math.round(SAMPLE_BOOK_WORDS / usual))}</strong>
          <small>{t('speed.sampleBook')}</small>
        </div>
      </div>

      <h4>{t('speed.byMonth')}</h4>
      <div className="goals-chart" role="img" aria-label={t('speed.byMonth')}>
        {months.map((m) => {
          const [y, mo] = m.key.split('-').map(Number)
          const date = new Date(y!, mo! - 1, 1)
          const label = date.toLocaleDateString(localeTag(), { month: 'long', year: 'numeric' })
          return (
            <div key={m.key} className="goals-bar" title={`${label}: ${m.wpm === null ? '—' : t('speed.wpm', { n: m.wpm })}`}>
              {m.wpm !== null && <em style={{ bottom: `${(m.wpm / max) * 100}%` }}>{m.wpm}</em>}
              <span style={{ height: `${((m.wpm ?? 0) / max) * 100}%` }} />
              <small>{date.toLocaleDateString(localeTag(), { month: 'narrow' })}</small>
            </div>
          )
        })}
      </div>

      {langs.length > 0 && (
        <>
          <h4>{t('speed.byLanguage')}</h4>
          <ul className="speed-list">
            {langs.map((l) => (
              <li key={l.lang}>
                <span className="speed-name">{langName(l.lang)}</span>
                <span>{t('speed.wpm', { n: l.wpm })}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {books === undefined ? (
        <small className="goals-note">{t('common.loading')}</small>
      ) : faster.length + slower.length === 0 ? (
        <small className="goals-note">{t('speed.booksNone')}</small>
      ) : (
        <>
          {faster.length > 0 && (
            <>
              <h4>{t('speed.faster')}</h4>
              <ul className="speed-list">{faster.map(row)}</ul>
            </>
          )}
          {slower.length > 0 && (
            <>
              <h4>{t('speed.slower')}</h4>
              <ul className="speed-list">{slower.map(row)}</ul>
            </>
          )}
        </>
      )}
      <small className="goals-note">{t('speed.note')}</small>
    </>
  )
}
