import { useEffect, useState } from 'react'
import { Dialog } from '../Dialog'
import { Cover } from './Cover'
import type { BookMeta } from '../../lib/db'
import type { PendingName } from '../../lib/autoIdentify'
import { formatBookName, isJunkTitle } from '../../lib/bookName'
import { CATALOG_NAMES, catalogStats, resetCatalogStats, type CatalogStats, type Clue, type LibraryNames } from '../../lib/bookLookup'
import { identifyWithCover } from '../../lib/coverIdentify'
import { bookDetails } from '../../lib/bookText'
import { t } from '../../i18n'

export type NameChange = { id: string; title: string; author: string }

type Suggestion = NameChange & {
  was: string
  online: boolean
  sites?: string[]
  fromText: boolean
  fromMeta: boolean
  pick: boolean
  /** the user changed the offered name here: it is saved as a correction, and the identification learns from it */
  edited?: boolean
  evidence?: Clue[]
  conflicts?: Clue[]
}

/** Identifies the books one after another and offers the new names; only the ticked ones are saved. With `waiting`,
 *  it offers the names found in the background (lib/autoIdentify) instead, and reports which were turned down. */
export function IdentifyDialog({
  books,
  online,
  waiting,
  library,
  onSave,
  onCancel,
}: {
  books: BookMeta[]
  /** whether the catalogs online may be asked (the user agreed); otherwise only the library's own names are read */
  online: boolean
  waiting?: PendingName[]
  /** the library's series and authors (libraryNames) */
  library?: LibraryNames
  /** `declined`: the books whose offered name was not ticked */
  onSave: (changes: NameChange[], declined: string[]) => void
  onCancel: () => void
}) {
  const [found, setFound] = useState<Suggestion[]>(
    () =>
      waiting?.map((w) => ({
        id: w.id,
        title: w.title,
        author: w.author,
        was: w.was,
        online: w.source === 'web',
        sites: w.sites,
        evidence: w.evidence,
        conflicts: w.conflicts,
        fromText: w.source === 'text',
        fromMeta: w.source === 'meta',
        // a name a clue speaks against is offered unchecked: the user picks it on purpose
        pick: !w.conflicts?.length,
      })) ?? [],
  )
  const [done, setDone] = useState(() => (waiting ? books.length : 0))
  // how the catalogs answered this run, so a run that found nothing says why
  const [answers, setAnswers] = useState<CatalogStats>()
  // the suggestion being corrected right here, so a wrong name needs no trip to the book
  const [editing, setEditing] = useState<string>()

  useEffect(() => {
    if (waiting) return
    const ac = new AbortController()
    resetCatalogStats()
    void (async () => {
      for (const b of books) {
        // the opening pages and the EPUB's package are read too: they name the book when its file name does not
        const { opening, meta } = await bookDetails(b, ac.signal).catch(() => ({ opening: [], meta: undefined }))
        if (ac.signal.aborted) return
        const r = await identifyWithCover(b, online, ac.signal, opening, meta, library).catch(() => undefined)
        if (ac.signal.aborted) return
        const title = r && formatBookName(r)
        const author = r?.author ?? ''
        if (r && title && (!isJunkTitle(r.title) || (r.series && r.number)) && (title !== b.title || author !== (b.author ?? '').trim())) {
          setFound((f) => [...f, { id: b.id, title, author, was: b.title, online: r.online, sites: r.sites, fromText: !!r.fromText, fromMeta: !!r.fromMeta, evidence: r.evidence, conflicts: r.conflicts, pick: !r.conflicts?.length }])
        }
        setAnswers(structuredClone(catalogStats()))
        setDone((n) => n + 1)
      }
    })()
    return () => ac.abort()
  }, [books, online, waiting, library])

  const bookById = new Map(books.map((b) => [b.id, b]))
  const running = done < books.length
  const picked = found.filter((f) => f.pick)
  const allPicked = picked.length === found.length
  const toggle = (id: string) => setFound((f) => f.map((x) => (x.id === id ? { ...x, pick: !x.pick } : x)))
  const unchanged = done - found.length
  // a changed name is picked by the change itself: the user wrote it on purpose
  const edit = (id: string, patch: Partial<Pick<Suggestion, 'title' | 'author'>>) =>
    setFound((f) => f.map((x) => (x.id === id ? { ...x, ...patch, edited: true, pick: true } : x)))

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <Dialog
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('identify.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>{t('identify.title')}</h2>
        {found.length > 0 && <small className="muted">{t(waiting ? 'identify.reviewHint' : 'identify.hint')}</small>}
        {found.length > 1 && (
          <button className="quiet" onClick={() => setFound((f) => f.map((x) => ({ ...x, pick: !allPicked })))}>
            {allPicked ? t('identify.pickNone') : t('identify.pickAll')}
          </button>
        )}
        {found.length > 0 && (
          <ul className="dup-list">
            {found.map((f) => (
              <li key={f.id}>
                {editing === f.id ? (
                  <div className="pick-row">
                    {bookById.get(f.id) && (
                      <span className="identify-cover">
                        <Cover book={bookById.get(f.id)!} />
                      </span>
                    )}
                    <span className="identify-item identify-edit">
                      <label>
                        {t('identify.fieldTitle')}
                        <input
                          autoFocus
                          value={f.title}
                          onChange={(e) => edit(f.id, { title: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), setEditing(undefined))}
                        />
                      </label>
                      <label>
                        {t('identify.fieldAuthor')}
                        <input
                          value={f.author}
                          onChange={(e) => edit(f.id, { author: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), setEditing(undefined))}
                        />
                      </label>
                      <button className="quiet" onClick={() => setEditing(undefined)}>
                        {t('identify.editDone')}
                      </button>
                    </span>
                  </div>
                ) : (
                  <>
                    <label className="pick-row">
                      <input type="checkbox" checked={f.pick} onChange={() => toggle(f.id)} />
                      {bookById.get(f.id) && (
                        <span className="identify-cover">
                          <Cover book={bookById.get(f.id)!} />
                        </span>
                      )}
                      <span className="identify-item">
                        <span>{f.title}</span>
                        <small className="muted">
                          {[f.author, f.online ? f.sites?.join(' + ') || t('identify.fromWeb') : f.fromText ? t('identify.fromText') : f.fromMeta ? t('identify.fromMeta') : t('identify.fromName')].filter(Boolean).join(' · ')}
                        </small>
                        {f.evidence?.length ? <small className="muted">{t('identify.evidence', { list: clues(f.evidence) })}</small> : null}
                        {f.conflicts?.length ? <small className="identify-conflicts">{t('identify.conflicts', { list: clues(f.conflicts) })}</small> : null}
                        {f.edited && <small className="muted">{t('identify.edited')}</small>}
                        {f.was !== f.title && <small className="muted identify-was">{f.was}</small>}
                      </span>
                    </label>
                    <button className="quiet" aria-label={t('identify.editName')} onClick={() => setEditing(f.id)}>
                      {t('identify.editName')}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <small role="status" className="muted">
          {running
            ? t('identify.progress', { done: done + 1, total: books.length })
            : found.length
              ? unchanged > 0 && t('identify.unchanged', { n: unchanged })
              : t('identify.nothing')}
        </small>
        {!running && online && answers && <CatalogAnswers stats={answers} />}
        <div className="modal-actions">
          <button
            className="primary"
            disabled={running || (!picked.length && !waiting)}
            onClick={() =>
              onSave(
                picked.map(({ id, title, author }) => ({ id, title, author })),
                found.filter((f) => !f.pick).map((f) => f.id),
              )
            }
          >
            {waiting && !picked.length ? t('identify.declineAll') : t('identify.save', { n: picked.length })}
          </button>
          <button onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </Dialog>
    </div>
  )
}

/** one line per catalog asked: how many answers, refusals for quota and failures to answer */
function CatalogAnswers({ stats }: { stats: CatalogStats }) {
  const lines = (Object.keys(stats) as (keyof CatalogStats)[])
    .map((k) => {
      const s = stats[k]
      const parts = [
        s.ok && t('identify.statOk', { n: s.ok }),
        s.quota && t('identify.statQuota', { n: s.quota }),
        s.network && t('identify.statNetwork', { n: s.network }),
      ].filter(Boolean)
      if (s.last && (s.quota || s.network)) parts[parts.length - 1] += ` (${s.last})`
      return parts.length ? `${CATALOG_NAMES[k]}: ${parts.join(', ')}` : ''
    })
    .filter(Boolean)
  if (!lines.length) return null
  return (
    <small className="muted identify-catalogs">
      {t('identify.catalogs')}:
      {lines.map((l) => (
        <span key={l}>
          {l}
        </span>
      ))}
    </small>
  )
}

/** the clues' names, for a line under a suggestion */
const clues = (list: Clue[]) => list.map((c) => t(`identify.clue.${c}`)).join(', ')
