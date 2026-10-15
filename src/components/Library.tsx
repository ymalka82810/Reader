import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deleteBook, isFinished, listBooks, setFinished, updateMeta, type BookRecord } from '../lib/db'
import { importFile } from '../lib/importBook'
import { PasswordRequiredError, WrongPasswordError } from '../lib/encrypt'
import { backupDue, exportLibrary, importLibrary, markBackedUp } from '../lib/backup'
import { download } from '../lib/download'
import { onLaunchFiles, takeSharedFiles } from '../lib/inbox'
import { formatBytes, getStorageStatus, type StorageStatus } from '../lib/storage'

function Cover({ book }: { book: BookRecord }) {
  const [url, setUrl] = useState<string>()
  const holder = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  // Only materialise the cover blob once the card is near the viewport.
  useEffect(() => {
    const el = holder.current
    if (visible || !el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])
  useEffect(() => {
    if (!visible || !book.cover) return
    const u = URL.createObjectURL(book.cover)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [visible, book.cover])
  if (url) return <img className="cover" src={url} alt="" decoding="async" />
  return (
    <div className="cover placeholder" ref={holder}>
      <span>{book.title}</span>
    </div>
  )
}

export default function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const [books, setBooks] = useState<BookRecord[]>([])
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [drag, setDrag] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'title' | 'author' | 'added'>('recent')
  const [filter, setFilter] = useState<'all' | 'reading' | 'unread' | 'finished'>('all')
  const [editing, setEditing] = useState<BookRecord>()
  const [editTitle, setEditTitle] = useState('')
  const [editAuthor, setEditAuthor] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const restoreInput = useRef<HTMLInputElement>(null)
  const [storage, setStorage] = useState<StorageStatus>()
  const [dismissed, setDismissed] = useState(false)
  const [menu, setMenu] = useState(false)
  const [toast, setToast] = useState<{ msg: string; undo?: () => void }>()
  const toastTimer = useRef<number>(undefined)
  // a delete waits out the undo window before it touches the database
  const pending = useRef<{ book: BookRecord; timer: number }>(undefined)
  const [hiddenId, setHiddenId] = useState<string>()
  // password prompt: for a new backup (optional password) or for restoring an encrypted one
  const [pwAsk, setPwAsk] = useState<{ kind: 'export' } | { kind: 'import'; file: File; wrong?: boolean }>()
  const [pw, setPw] = useState('')

  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks())
    } catch (e) {
      console.error(e)
      setError('לא ניתן לגשת לאחסון של הדפדפן, אז הספרייה לא נטענה. ייתכן שמצב גלישה פרטית חוסם אותו.')
    }
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])
  useEffect(() => {
    getStorageStatus().then(setStorage)
  }, [])

  // without persistent storage the browser may evict the library, so remind sooner
  const unprotected = storage ? !storage.persisted : false
  const remind = useMemo(() => !dismissed && backupDue(unprotected), [dismissed, unprotected])

  const showToast = (msg: string, undo?: () => void, ms = 4000) => {
    window.clearTimeout(toastTimer.current)
    setToast({ msg, undo })
    toastTimer.current = window.setTimeout(() => setToast(undefined), ms)
  }

  const commitDelete = useCallback(async () => {
    const p = pending.current
    if (!p) return
    pending.current = undefined
    window.clearTimeout(p.timer)
    await deleteBook(p.book.id)
    setHiddenId((h) => (h === p.book.id ? undefined : h))
  }, [])

  const removeBook = async (b: BookRecord) => {
    await commitDelete() // an earlier pending delete becomes final
    setHiddenId(b.id)
    pending.current = { book: b, timer: window.setTimeout(() => commitDelete().then(refresh), 5000) }
    showToast(
      `״${b.title}״ נמחק`,
      () => {
        const p = pending.current
        if (!p) return
        window.clearTimeout(p.timer)
        pending.current = undefined
        setHiddenId(undefined)
        setToast(undefined)
      },
      5000,
    )
  }

  // never lose a delete the user already saw go through
  useEffect(() => {
    const flush = () => void commitDelete()
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [commitDelete])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const state = (b: BookRecord) => (isFinished(b) ? 'finished' : b.fraction ? 'reading' : 'unread')
    const list = books.filter(
      (b) =>
        b.id !== hiddenId &&
        (filter === 'all' || state(b) === filter) &&
        (!q || `${b.title} ${b.author} ${b.fileName}`.toLowerCase().includes(q)),
    )
    const by = (f: (b: BookRecord) => string) => (a: BookRecord, b: BookRecord) =>
      f(a).localeCompare(f(b), 'he')
    if (sort === 'title') list.sort(by((b) => b.title))
    else if (sort === 'author') list.sort(by((b) => b.author || '￿'))
    else if (sort === 'added') list.sort((a, b) => b.addedAt - a.addedAt)
    return list // 'recent' keeps the order listBooks returns
  }, [books, query, sort, filter, hiddenId])

  const addFiles = async (files: FileList | File[]) => {
    setError(undefined)
    const errors: string[] = []
    for (const f of Array.from(files)) {
      try {
        setBusy(`מוסיף את ${f.name}…`)
        await importFile(f, setBusy)
      } catch (e) {
        errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setBusy(undefined)
    if (errors.length) setError(errors.join('\n'))
    await refresh()
  }

  const addRef = useRef(addFiles)
  addRef.current = addFiles
  useEffect(() => {
    takeSharedFiles().then((f) => {
      if (f.length) addRef.current(f)
    })
    onLaunchFiles((f) => addRef.current(f))
  }, [])

  const doExport = async (password?: string) => {
    setError(undefined)
    try {
      setBusy('מכין גיבוי…')
      const blob = await exportLibrary((d, t) => setBusy(`מכין גיבוי… ${d}/${t}`), password)
      download(blob, `גיבוי-ספרייה-${new Date().toISOString().slice(0, 10)}.readerbackup`)
      markBackedUp()
      setDismissed(true)
    } catch (e) {
      setError(`גיבוי נכשל: ${e instanceof Error ? e.message : String(e)}`)
    }
    setBusy(undefined)
  }

  const doImport = async (file: File, password?: string) => {
    setError(undefined)
    try {
      setBusy('משחזר גיבוי…')
      const n = await importLibrary(file, (d, t) => setBusy(`משחזר גיבוי… ${d}/${t}`), password)
      setBusy(undefined)
      showToast(`שוחזרו ${n} ספרים`)
    } catch (e) {
      setBusy(undefined)
      if (e instanceof PasswordRequiredError || e instanceof WrongPasswordError) {
        setPw('')
        setPwAsk({ kind: 'import', file, wrong: e instanceof WrongPasswordError })
      } else {
        setError(`שחזור נכשל: ${e instanceof SyntaxError ? 'קובץ הגיבוי פגום' : e instanceof Error ? e.message : String(e)}`)
      }
    }
    await refresh()
  }

  const submitPw = () => {
    const ask = pwAsk
    if (!ask) return
    setPwAsk(undefined)
    if (ask.kind === 'export') doExport(pw || undefined)
    else doImport(ask.file, pw)
  }

  const openEdit = (b: BookRecord) => {
    setEditing(b)
    setEditTitle(b.title)
    setEditAuthor(b.author || '')
  }

  const saveEdit = async () => {
    if (!editing) return
    const title = editTitle.trim()
    if (!title) return
    await updateMeta(editing.id, title, editAuthor.trim())
    setEditing(undefined)
    await refresh()
  }

  return (
    <div
      className={'library' + (drag ? ' drag' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        addFiles(e.dataTransfer.files)
      }}
    >
      <header className="lib-header">
        <h1>הספרייה שלי</h1>
        <button className="primary" onClick={() => input.current?.click()} disabled={!!busy}>
          + הוסף ספר
        </button>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept=".epub,.pdf,.txt,application/epub+zip,application/pdf,text/plain"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div className="menu-wrap">
          <button
            aria-label="עוד פעולות"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            ⋯
          </button>
          {menu && (
            <>
              <div className="menu-backdrop" onClick={() => setMenu(false)} />
              <div className="menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
                {(
                  [
                    ['גיבוי', () => { setPw(''); setPwAsk({ kind: 'export' }) }, 'ספרים, מיקום קריאה, הערות והגדרות (אפשר להצפין בסיסמה)'],
                    ['שחזור', () => restoreInput.current?.click(), 'מוסיף ספרים חסרים וממזג מיקום והערות'],
                  ] as [string, () => void, string][]
                ).map(([label, fn, tip]) => (
                  <button
                    key={label}
                    role="menuitem"
                    title={tip}
                    disabled={!!busy}
                    onClick={() => {
                      setMenu(false)
                      fn()
                    }}
                  >
                    {label}
                  </button>
                ))}
                {storage && (
                  <div className="menu-info" role="status">
                    {storage.persisted ? 'אחסון קבוע ✓' : 'אחסון לא קבוע — הדפדפן עלול למחוק את הספרייה'}
                    {storage.usage != null && storage.quota
                      ? ` · בשימוש ${formatBytes(storage.usage)} מתוך ${formatBytes(storage.quota)}`
                      : ''}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <input
          ref={restoreInput}
          type="file"
          hidden
          accept=".readerbackup"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) doImport(f)
            e.target.value = ''
          }}
        />
      </header>

      {remind && books.length > 0 && (
        <div className={'notice' + (unprotected ? ' error' : '')} onClick={() => setDismissed(true)}>
          {unprotected
            ? 'הדפדפן לא אישר אחסון קבוע, והספרייה עלולה להימחק בכל רגע. עברו כמה ימים בלי גיבוי — ב־⋯ בחר ״גיבוי״ לשמירת עותק.'
            : 'עברו יותר משבועיים בלי גיבוי. הדפדפן עלול למחוק את הספרייה — ב־⋯ בחר ״גיבוי״ לשמירת עותק.'}
        </div>
      )}

      {books.length > 1 && (
        <div className="lib-tools">
          <input
            type="search"
            placeholder="חיפוש לפי שם או מחבר…"
            aria-label="חיפוש בספרייה"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="סינון">
            <option value="all">הכול</option>
            <option value="reading">בקריאה</option>
            <option value="unread">לא התחלתי</option>
            <option value="finished">נקראו</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="מיון">
            <option value="recent">נפתח לאחרונה</option>
            <option value="added">נוסף לאחרונה</option>
            <option value="title">שם (א–ת)</option>
            <option value="author">מחבר (א–ת)</option>
          </select>
        </div>
      )}

      {busy && <div className="notice">{busy}</div>}
      {error && (
        <div className="notice error" onClick={() => setError(undefined)}>
          {error}
        </div>
      )}

      {books.length === 0 && !busy ? (
        <div className="empty">
          <p>אין עדיין ספרים.</p>
          <p>לחץ על ״הוסף ספר״ ובחר קובץ EPUB, PDF או TXT מהטלפון או מגוגל דרייב.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <p>{query ? `לא נמצאו ספרים עבור ״${query}״.` : 'אין ספרים בסינון הזה.'}</p>
        </div>
      ) : (
        <ul className="grid">
          {shown.map((b) => (
            <li key={b.id}>
              <button className="card" onClick={() => onOpen(b.id)}>
                <Cover book={b} />
                <div className="meta">
                  <strong>{b.title}</strong>
                  {b.author && <small>{b.author}</small>}
                  <small className="kind">
                    {b.fromPdf ? 'PDF' : b.kind.toUpperCase()}
                    {b.fraction ? ` · ${Math.round(b.fraction * 100)}%` : ''}
                    {isFinished(b) ? ' · נקרא ✓' : ''}
                  </small>
                </div>
              </button>
              <button
                className={'fin' + (isFinished(b) ? ' on' : '')}
                aria-label={isFinished(b) ? 'סמן כלא נקרא' : 'סמן כנקרא'}
                aria-pressed={isFinished(b)}
                onClick={async () => {
                  await setFinished(b.id, !isFinished(b))
                  refresh()
                }}
              >
                ✓
              </button>
              <button className="edit-btn" aria-label="עריכת שם ומחבר" onClick={() => openEdit(b)}>
                ✎
              </button>
              <button
                className="del"
                aria-label="מחק"
                onClick={() => removeBook(b)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {toast && (
        <div className="lib-toast" role="status">
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={toast.undo}>בטל</button>}
        </div>
      )}

      {pwAsk && (
        <div className="modal-backdrop" onClick={() => setPwAsk(undefined)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={pwAsk.kind === 'export' ? 'גיבוי' : 'גיבוי מוצפן'}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPwAsk(undefined)
              else if (e.key === 'Enter' && (pwAsk.kind === 'export' || pw)) submitPw()
            }}
          >
            <h2>{pwAsk.kind === 'export' ? 'גיבוי' : 'הגיבוי מוצפן'}</h2>
            <label>
              {pwAsk.kind === 'export' ? 'סיסמה להצפנה (אופציונלי)' : 'סיסמה'}
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="off" />
            </label>
            {pwAsk.kind === 'export' && (
              <small>
                השאירו ריק לגיבוי רגיל. עם סיסמה אין דרך לשחזר את הגיבוי אם היא אבדה.
              </small>
            )}
            {pwAsk.kind === 'import' && pwAsk.wrong && <small role="alert">הסיסמה שגויה, נסו שוב.</small>}
            <div className="modal-actions">
              <button className="primary" onClick={submitPw} disabled={pwAsk.kind === 'import' && !pw}>
                {pwAsk.kind === 'export' ? 'צור גיבוי' : 'שחזר'}
              </button>
              <button onClick={() => setPwAsk(undefined)}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(undefined)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="עריכת פרטי ספר"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(undefined)
              else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') saveEdit()
            }}
          >
            <h2>עריכת פרטי ספר</h2>
            <label>
              שם הספר
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                autoFocus
              />
            </label>
            <label>
              מחבר
              <input value={editAuthor} onChange={(e) => setEditAuthor(e.target.value)} />
            </label>
            <div className="modal-actions">
              <button className="primary" onClick={saveEdit} disabled={!editTitle.trim()}>
                שמירה
              </button>
              <button onClick={() => setEditing(undefined)}>ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
