import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { blindReport, runBlindTest } from '../../lib/blindTest'
import { knowledgeReport } from '../../lib/bookKnowledge'
import { fingerprintBooks } from '../../lib/bookLookup'
import { listBooks } from '../../lib/db'
import { deviceBooksSupported } from '../../lib/deviceBooks'
import { download } from '../../lib/download'
import { clueReport, coverage, isConfirmed, learntSources, outcomes } from '../../lib/identifyLearning'
import { modelReport } from '../../lib/identifyModel'
import { linesReport } from '../../lib/lineModel'
import { wordsReport } from '../../lib/wordModel'
import { saveBlobToPhone } from '../../lib/phoneFiles'
import { loadSeriesDb, seriesDbSize } from '../../lib/seriesDb'
import { Row } from './parts'

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—')
/** a clue's record, which the blind tests add halves to */
const tallied = (n: number) => Math.round(n * 10) / 10

/** How well the identification does: the library's books by where they stand, the user's answers about the names it
 *  found, what each clue taught, and what is known on the device. Read when opened. */
export function IdentifyStats() {
  const [open, setOpen] = useState(false)
  const [books, setBooks] = useState<Awaited<ReturnType<typeof listBooks>>>()
  const [exporting, setExporting] = useState<string>()
  // the blind test run from here: its progress, then the report read again
  const [blind, setBlind] = useState<string>()
  const [blindTick, setBlindTick] = useState(0)
  useEffect(() => {
    if (!open) return
    let live = true
    void Promise.all([listBooks().catch(() => []), loadSeriesDb()]).then(([b]) => live && setBooks(b))
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
  const bundled = seriesDbSize()
  const model = modelReport()
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
      <BlindTest books={books} busy={blind} tick={blindTick} onRun={() => void runBlind(books, setBlind, () => setBlindTick((n) => n + 1))} />
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
                <td>{t('stats.rightWrong', { right: tallied(r.agreed.right), wrong: tallied(r.agreed.wrong) })}</td>
                <td>{t('stats.rightWrong', { right: tallied(r.against.right), wrong: tallied(r.against.wrong) })}</td>
                <td>{[r.counts ? t('stats.counts') : t('stats.weak'), r.blocks ? '' : t('stats.noBlock')].filter(Boolean).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {learntSources().length > 0 && (
        <p>{t('identify.oneSource', { list: learntSources().map(([a, b]) => `${t(`identify.clue.${a}`)} + ${t(`identify.clue.${b}`)}`).join(', ') })}</p>
      )}
      <h4>{t('stats.model')}</h4>
      <p>{t(model.ready ? 'stats.modelReady' : 'stats.modelLearning', { n: model.answers, wrong: model.wrong })}</p>
      <p>{t('stats.lines', { n: linesReport() })}</p>
      <p>{t('stats.words', { n: wordsReport() })}</p>
      <h4>{t('stats.knowledge')}</h4>
      <p>{t('stats.known', { books: k.books, printed: k.lists.book, wikidata: k.lists.wikidata, library: k.lists.library, sequel: k.lists.sequel, fingerprints: fingerprintBooks() })}</p>
      {bundled.series > 0 && <p>{t('stats.bundled', { series: bundled.series, books: bundled.books })}</p>}
      <Row label={t('stats.bench')} hint={t('stats.benchHint')}>
        <button disabled={!!exporting} onClick={() => void exportCases(books, setExporting)}>
          {exporting ?? t('stats.benchExport')}
        </button>
      </Row>
    </div>
  )
}

/** The books whose names the user approved or saved, as cases for the identification's benchmark (identifyBench):
 *  what each came with and the name it has now. Saved as a JSON file to add to the benchmark's cases. */
async function exportCases(books: Awaited<ReturnType<typeof listBooks>>, busy: (s: string | undefined) => void) {
  const mine = books.filter((b) => (b.kind === 'epub' || b.kind === 'pdf') && isConfirmed(b.id, b.title))
  const [{ bookDetails }, { caseFromBook }] = await Promise.all([import('../../lib/bookText'), import('../../lib/identifyBench')])
  const cases = []
  try {
    for (const [i, b] of mine.entries()) {
      busy(t('stats.benchProgress', { done: i, total: mine.length }))
      cases.push(caseFromBook(b, await bookDetails(b)))
    }
    const blob = new Blob([JSON.stringify(cases, null, 1)], { type: 'application/json' })
    const name = 'identify-cases.json'
    if (deviceBooksSupported()) await saveBlobToPhone(blob, name)
    else download(blob, name)
  } catch (e) {
    console.warn(e)
  } finally {
    busy(undefined)
  }
}

/** what the blind tests found (lib/blindTest): each part of the name, the names that would have been saved alone, and the
 *  clues that spoke, measured on this library; and a button to test now */
function BlindTest({ books, busy, tick, onRun }: { books: { id: string; title: string }[]; busy?: string; tick: number; onRun: () => void }) {
  void tick // read again after a run
  const r = blindReport(books)
  const of = (x: { right: number; of: number }) => pct(x.right, x.of)
  return (
    <>
      <h4>{t('stats.blind')}</h4>
      <p>
        {r.books
          ? t('stats.blindResult', {
              n: r.books,
              whole: of(r.whole),
              series: of(r.parts.series),
              number: of(r.parts.number),
              title: of(r.parts.title),
              author: of(r.parts.author),
              sure: r.sure.of,
              sureRight: of(r.sure),
            })
          : t('stats.blindNone')}
      </p>
      {r.clues.length > 0 && (
        <p>
          {t('stats.blindClues', {
            list: r.clues
              .map((c) => `${t(`identify.clue.${c.clue}`)} ${[c.agreed.of ? of(c.agreed) : '', c.against.of ? `↯${of(c.against)}` : ''].filter(Boolean).join(' ')}`)
              .join(', '),
          })}
        </p>
      )}
      {r.books > 0 && <p className="muted">{t('stats.blindLearns')}</p>}
      <Row label={t('stats.blindRun')} hint={t('stats.blindHint')}>
        <button disabled={!!busy} onClick={onRun}>
          {busy ?? t('stats.blindStart')}
        </button>
      </Row>
    </>
  )
}

async function runBlind(books: Awaited<ReturnType<typeof listBooks>>, busy: (s: string | undefined) => void, done: () => void) {
  try {
    await runBlindTest(books, undefined, { max: 30, onProgress: (d, total) => busy(t('stats.blindProgress', { done: d, total })) })
  } catch (e) {
    console.warn(e)
  } finally {
    busy(undefined)
    done()
  }
}
