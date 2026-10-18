import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../Dialog'
import { t } from '../../i18n'
import { hasConsent, setConsent, SERVICE_HOST } from '../../lib/consent'
import {
  downloadEntry,
  fetchFeed,
  loadCatalogs,
  pickAcquisition,
  safeUrl,
  saveCatalogs,
  searchUrl,
  type Catalog,
  type OpdsEntry,
  type OpdsFeed,
} from '../../lib/opds'

type Props = {
  onClose: () => void
  /** hands a downloaded book to the normal importer */
  onAdd: (file: File) => Promise<void>
}

/** browse an OPDS catalog (Project Gutenberg, Calibre-web, …), search it and add books to the library */
export function CatalogDialog({ onClose, onAdd }: Props) {
  const [ok, setOk] = useState(() => hasConsent('opds'))
  const [catalogs, setCatalogs] = useState<Catalog[]>(loadCatalogs)
  const [current, setCurrent] = useState(0)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  // the pages opened so far (for "back"), and the feed on show
  const [trail, setTrail] = useState<OpdsFeed[]>([])
  const [feed, setFeed] = useState<OpdsFeed>()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [downloading, setDownloading] = useState<string>()
  const [added, setAdded] = useState<Set<string>>(new Set())
  const abort = useRef<AbortController>(undefined)

  const catalog = catalogs[current]
  // the start page of a catalog is loading until it arrives or fails
  const starting = ok && !!catalog && !feed && !error

  const load = async (url: string, push?: OpdsFeed) => {
    abort.current?.abort()
    const ctl = (abort.current = new AbortController())
    setLoading(true)
    setError(undefined)
    try {
      const next = await fetchFeed(url, ctl.signal)
      if (ctl.signal.aborted) return
      if (push) setTrail((tr) => [...tr, push])
      setFeed(next)
    } catch (e) {
      if (ctl.signal.aborted) return
      console.error(e)
      setError(t('opds.failed'))
    } finally {
      if (!ctl.signal.aborted) setLoading(false)
    }
  }

  // open the catalog's start page when it is chosen
  useEffect(() => {
    if (!ok || !catalog) return
    const ctl = new AbortController()
    fetchFeed(catalog.url, ctl.signal)
      .then(setFeed)
      .catch((e) => {
        if (ctl.signal.aborted) return
        console.error(e)
        setError(t('opds.failed'))
      })
    return () => ctl.abort()
  }, [ok, catalog?.url]) // eslint-disable-line react-hooks/exhaustive-deps

  /** switch catalogs: the old pages no longer apply */
  const pick = (i: number) => {
    setCurrent(i)
    setTrail([])
    setFeed(undefined)
    setError(undefined)
  }

  const search = async () => {
    if (!feed?.search || !query.trim()) return
    setLoading(true)
    setError(undefined)
    try {
      const url = await searchUrl(feed.search, query.trim())
      await load(url, feed)
    } catch (e) {
      console.error(e)
      setError(t('opds.failed'))
      setLoading(false)
    }
  }

  const addCatalog = () => {
    const url = safeUrl(newUrl.trim(), newUrl.trim())
    if (!url || !newName.trim()) return setError(t('opds.badUrl'))
    const next = [...catalogs, { name: newName.trim(), url }]
    saveCatalogs(next)
    setCatalogs(next)
    pick(next.length - 1)
    setAdding(false)
    setNewName('')
    setNewUrl('')
    setError(undefined)
  }

  const removeCatalog = () => {
    const next = catalogs.filter((_, i) => i !== current)
    saveCatalogs(next)
    setCatalogs(next)
    pick(0)
  }

  const add = async (e: OpdsEntry) => {
    setDownloading(e.id)
    setError(undefined)
    try {
      await onAdd(await downloadEntry(e))
      setAdded((s) => new Set(s).add(e.id))
    } catch (err) {
      console.error(err)
      setError(t('opds.downloadFailed', { title: e.title }))
    } finally {
      setDownloading(undefined)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <Dialog
        className="modal catalog"
        role="dialog"
        aria-modal="true"
        aria-label={t('opds.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>{t('opds.title')}</h2>
        {!ok ? (
          <>
            <p>{t('opds.consent', { host: SERVICE_HOST.opds })}</p>
            <div className="modal-actions">
              <button onClick={onClose}>{t('common.cancel')}</button>
              <button
                className="primary"
                autoFocus
                onClick={() => {
                  setConsent('opds', true)
                  setOk(true)
                }}
              >
                {t('consent.allow')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="catalog-bar">
              <select aria-label={t('opds.catalog')} value={current} onChange={(e) => pick(Number(e.target.value))}>
                {catalogs.map((c, i) => (
                  <option key={c.url} value={i}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button onClick={() => setAdding(!adding)} aria-expanded={adding}>
                {t('opds.add')}
              </button>
              {catalog && (
                <button onClick={removeCatalog} aria-label={t('opds.remove', { name: catalog.name })}>
                  ✕
                </button>
              )}
            </div>
            {adding && (
              <form
                className="catalog-add"
                onSubmit={(e) => {
                  e.preventDefault()
                  addCatalog()
                }}
              >
                <input placeholder={t('opds.name')} value={newName} onChange={(e) => setNewName(e.target.value)} />
                <input
                  placeholder="https://…/opds"
                  dir="ltr"
                  inputMode="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
                <button className="primary" type="submit">
                  {t('opds.save')}
                </button>
                <small className="muted">{t('opds.hint')}</small>
              </form>
            )}
            {feed?.search && (
              <form
                className="catalog-bar"
                onSubmit={(e) => {
                  e.preventDefault()
                  void search()
                }}
              >
                <input type="search" aria-label={t('opds.search')} placeholder={t('opds.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
                <button type="submit" disabled={loading || !query.trim()}>
                  {t('opds.searchGo')}
                </button>
              </form>
            )}
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {trail.length > 0 && (
              <button
                onClick={() => {
                  const prev = trail[trail.length - 1]!
                  setTrail(trail.slice(0, -1))
                  setFeed(prev)
                }}
              >
                {t('opds.back')}
              </button>
            )}
            {feed && <h3>{feed.title}</h3>}
            {(loading || starting) && <p className="muted">{t('common.loading')}</p>}
            <ul className="catalog-list">
              {feed?.entries.map((e, i) => {
                const acq = pickAcquisition(e)
                return (
                  <li key={e.id || i}>
                    {e.cover && <img src={e.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                    <div className="catalog-info">
                      {e.nav && !acq ? (
                        <button className="link" onClick={() => void load(e.nav!, feed)}>
                          {e.title} ›
                        </button>
                      ) : (
                        <strong dir="auto">{e.title}</strong>
                      )}
                      {e.author && <small dir="auto">{e.author}</small>}
                    </div>
                    {acq && (
                      <button
                        disabled={!!downloading || added.has(e.id)}
                        onClick={() => void add(e)}
                        aria-label={t('opds.addBook', { title: e.title })}
                      >
                        {added.has(e.id) ? '✓' : downloading === e.id ? t('common.loading') : t('opds.addShort')}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {feed && !loading && feed.entries.length === 0 && <p className="muted">{t('opds.empty')}</p>}
            {feed?.next && (
              <button disabled={loading} onClick={() => void load(feed.next!, feed)}>
                {t('opds.more')}
              </button>
            )}
            <div className="modal-actions">
              <button className="primary" onClick={onClose}>
                {t('common.close')}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  )
}
