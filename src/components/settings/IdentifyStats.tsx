import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { knowledgeReport } from '../../lib/bookKnowledge'
import { fingerprintBooks } from '../../lib/bookLookup'
import { listBooks } from '../../lib/db'
import { clueReport, coverage, outcomes } from '../../lib/identifyLearning'
import { Row } from './parts'

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—')

/** How well the identification does: the library's books by where they stand, the user's answers about the names it
 *  found, what each clue taught, and what is known on the device. Read when opened. */
export function IdentifyStats() {
  const [open, setOpen] = useState(false)
  const [books, setBooks] = useState<{ id: string; title: string }[]>()
  useEffect(() => {
    if (!open) return
    let live = true
    void listBooks()
      .catch(() => [])
      .then((b) => live && setBooks(b))
    return () => {
      live = false
    }
  }, [open])
  if (!open)
    return (
      <Row label={t('stats.title')} hint={t('stats.hint')}>
        <button onClick={() => setOpen(true)}>{t('stats.show')}</button>
      </Row>
    )
  if (!books)
    return (
      <Row label={t('stats.title')}>
        <small role="status" className="muted">
          {t('common.loading')}
        </small>
      </Row>
    )
  const c = coverage(books)
  const o = outcomes()
  const answered = o.approved + o.corrected + o.declined
  const k = knowledgeReport()
  return (
    <div className="identify-stats">
      <Row label={t('stats.title')}>
        <button onClick={() => setOpen(false)}>{t('stats.hide')}</button>
      </Row>
      <h4>{t('stats.library')}</h4>
      <p>
        {t('stats.coverage', {
          total: c.total,
          numbered: c.numbered,
          numberedPct: pct(c.numbered, c.total),
          seriesOnly: c.seriesOnly,
          none: c.none,
          confirmed: c.confirmed,
        })}
      </p>
      <h4>{t('stats.answers')}</h4>
      <p>
        {answered
          ? t('stats.suggestions', { n: answered, approved: pct(o.approved, answered), corrected: pct(o.corrected, answered), declined: pct(o.declined, answered) })
          : t('stats.noAnswers')}
        {o.autoSaved > 0 && <> {t('stats.auto', { n: o.autoSaved, right: pct(o.autoSaved - o.autoCorrected, o.autoSaved) })}</>}
      </p>
      <h4>{t('stats.clues')}</h4>
      <div className="table-scroll">
        <table className="identify-stats-table">
          <thead>
            <tr>
              <th>{t('stats.clue')}</th>
              <th>{t('stats.agreed')}</th>
              <th>{t('stats.against')}</th>
              <th>{t('stats.weight')}</th>
            </tr>
          </thead>
          <tbody>
            {clueReport().map((r) => (
              <tr key={r.clue}>
                <td>{t(`identify.clue.${r.clue}`)}</td>
                <td>{t('stats.rightWrong', { right: r.agreed.right, wrong: r.agreed.wrong })}</td>
                <td>{t('stats.rightWrong', { right: r.against.right, wrong: r.against.wrong })}</td>
                <td>{[r.counts ? t('stats.counts') : t('stats.weak'), r.blocks ? '' : t('stats.noBlock')].filter(Boolean).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>{t('stats.knowledge')}</h4>
      <p>{t('stats.known', { books: k.books, printed: k.lists.book, wikidata: k.lists.wikidata, library: k.lists.library, sequel: k.lists.sequel, fingerprints: fingerprintBooks() })}</p>
    </div>
  )
}
