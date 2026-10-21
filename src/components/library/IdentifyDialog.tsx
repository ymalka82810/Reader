import { useEffect, useState } from 'react'
import { Dialog } from '../Dialog'
import type { BookMeta } from '../../lib/db'
import type { PendingName } from '../../lib/autoIdentify'
import { formatBookName, isJunkTitle } from '../../lib/bookName'
import { identifyBook, type LibraryNames } from '../../lib/bookLookup'
import { bookDetails } from '../../lib/bookText'
import { t } from '../../i18n'

export type NameChange = { id: string; title: string; author: string }

type Suggestion = NameChange & { was: string; online: boolean; sites?: string[]; fromText: boolean; fromMeta: boolean; pick: boolean }

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
        fromText: w.source === 'text',
        fromMeta: w.source === 'meta',
        pick: true,
      })) ?? [],
  )
  const [done, setDone] = useState(() => (waiting ? books.length : 0))

  useEffect(() => {
    if (waiting) return
    const ac = new AbortController()
    void (async () => {
      for (const b of books) {
        // the opening pages and the EPUB's package are read too: they name the book when its file name does not
        const { opening, meta } = await bookDetails(b, ac.signal).catch(() => ({ opening: [], meta: undefined }))
        if (ac.signal.aborted) return
        const r = await identifyBook(b, online, ac.signal, opening, meta, library).catch(() => undefined)
        if (ac.signal.aborted) return
        const title = r && formatBookName(r)
        const author = r?.author ?? ''
        if (r && title && !isJunkTitle(r.title) && (title !== b.title || author !== (b.author ?? '').trim())) {
          setFound((f) => [...f, { id: b.id, title, author, was: b.title, online: r.online, sites: r.sites, fromText: !!r.fromText, fromMeta: !!r.fromMeta, pick: true }])
        }
        setDone((n) => n + 1)
      }
    })()
    return () => ac.abort()
  }, [books, online, waiting, library])

  const running = done < books.length
  const picked = found.filter((f) => f.pick)
  const allPicked = picked.length === found.length
  const toggle = (id: string) => setFound((f) => f.map((x) => (x.id === id ? { ...x, pick: !x.pick } : x)))
  const unchanged = done - found.length

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
                <label className="pick-row">
                  <input type="checkbox" checked={f.pick} onChange={() => toggle(f.id)} />
                  <span className="identify-item">
                    <span>{f.title}</span>
                    <small className="muted">
                      {[f.author, f.online ? f.sites?.join(' + ') || t('identify.fromWeb') : f.fromText ? t('identify.fromText') : f.fromMeta ? t('identify.fromMeta') : t('identify.fromName')].filter(Boolean).join(' · ')}
                    </small>
                    {f.was !== f.title && <small className="muted identify-was">{f.was}</small>}
                  </span>
                </label>
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
