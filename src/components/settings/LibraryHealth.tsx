import { useState } from 'react'
import { t } from '../../i18n'
import { listBooks, renameFolder, updateMeta, type BookMeta } from '../../lib/db'
import { clearNotCopies, copyGroups, notCopiesCount } from '../../lib/bookCopies'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmDialog } from '../library/Dialogs'
import { CopiesDialog } from '../library/CopiesDialog'
import { formatBookName, splitBookName } from '../../lib/bookName'
import { libraryHealth, type Issue } from '../../lib/seriesHealth'
import { Row } from './parts'

/** The library's check-up (seriesHealth): the names that are almost always a mistake, read when opened. One author
 *  under several spellings is put right here, every book of it taking the spelling most of them have (and with it the
 *  author's folder); the rest is listed, to fix in the book's details. */
export function LibraryHealth() {
  const [state, setState] = useState<{ books: BookMeta[]; issues: Issue[]; copies: BookMeta[][]; apart: number }>()
  const [copiesOpen, setCopiesOpen] = useState(false)
  const { pending: confirmAsk, confirm } = useConfirm()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const books = await listBooks().catch(() => [] as BookMeta[])
    setState({ books, issues: libraryHealth(books), copies: copyGroups(books), apart: notCopiesCount(books) })
  }
  if (!open)
    return (
      <Row label={t('health.title')} hint={t('health.hint')}>
        <button
          onClick={() => {
            setOpen(true)
            void load()
          }}
        >
          {t('health.check')}
        </button>
      </Row>
    )
  if (!state)
    return (
      <Row label={t('health.title')}>
        <small role="status" className="muted">
          {t('common.loading')}
        </small>
      </Row>
    )
  const merge = async (main: string, others: string[]) => {
    setBusy(true)
    try {
      for (const other of others) {
        for (const b of state.books) if (b.author.trim() === other) await updateMeta(b.id, b.title, main)
        // a folder named by the other spelling (folder is author) goes with it
        if (state.books.some((b) => b.folder?.trim() === other)) await renameFolder(other, main, true)
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  // the series' other spellings become the main one, each book keeping its number, title and author
  const mergeSeries = async (main: string, books: Extract<Issue, { kind: 'series' }>['books']) => {
    setBusy(true)
    try {
      for (const b of books) await updateMeta(b.id, formatBookName({ ...splitBookName(b.title), series: main }), b.author)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const { issues, copies } = state
  return (
    <div className="identify-stats library-health">
      <Row label={t('health.title')}>
        <button onClick={() => setOpen(false)}>{t('stats.hide')}</button>
      </Row>
      {!issues.length && !copies.length && !state.apart && <p>{t('health.none')}</p>}
      <ul>
        {copies.length > 0 && (
          <li>
            <span>{t('copies.notice', { n: copies.length })}: {copies.map((g) => g[0]!.title).join(' · ')}</span>{' '}
            <button disabled={busy} onClick={() => setCopiesOpen(true)}>
              {t('copies.show')}
            </button>
          </li>
        )}
        {state.apart > 0 && (
          <li>
            <span>{t('copies.apart', { n: state.apart })}</span>{' '}
            <button
              disabled={busy}
              onClick={() => {
                clearNotCopies()
                void load()
              }}
            >
              {t('copies.restore')}
            </button>
          </li>
        )}
        {issues.map((i, n) => (
          <li key={n}>
            {i.kind === 'author' ? (
              <>
                <span>{t('health.author', { main: i.main, others: i.others.join(', '), books: i.books })}</span>{' '}
                <button disabled={busy} onClick={() => void merge(i.main, i.others)}>
                  {t('health.merge', { main: i.main })}
                </button>
              </>
            ) : i.kind === 'series' ? (
              <>
                <span>{t('health.series', { main: i.main, others: i.others.join(', '), books: i.books.length })}</span>{' '}
                <button disabled={busy} onClick={() => void mergeSeries(i.main, i.books)}>
                  {t('health.merge', { main: i.main })}
                </button>
              </>
            ) : i.kind === 'duplicate' ? (
              <span>{t('health.duplicate', { series: i.series, number: i.number, books: i.books.map((b) => b.title).join(' · ') })}</span>
            ) : i.kind === 'authors' ? (
              <span>{t('health.authors', { series: i.series, authors: i.authors.join(', ') })}</span>
            ) : (
              <span>{t('health.gap', { series: i.series, missing: i.missing.join(', ') })}</span>
            )}
          </li>
        ))}
      </ul>
      {copiesOpen && <CopiesDialog groups={copies} confirm={confirm} onChanged={load} onClose={() => setCopiesOpen(false)} />}
      {confirmAsk && <ConfirmDialog ask={confirmAsk} />}
    </div>
  )
}
