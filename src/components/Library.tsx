import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deleteBook, isFinished, listBooks, setFinished, updateMeta, type BookRecord } from '../lib/db'
import { importFile } from '../lib/importBook'
import { backupDue, exportLibrary, importLibrary, markBackedUp } from '../lib/backup'
import { download } from '../lib/download'
import { exportSync, importSync } from '../lib/sync'

function Cover({ book }: { book: BookRecord }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!book.cover) return
    const u = URL.createObjectURL(book.cover)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [book.cover])
  if (url) return <img className="cover" src={url} alt="" />
  return (
    <div className="cover placeholder">
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
  const syncInput = useRef<HTMLInputElement>(null)
  const [remind, setRemind] = useState(backupDue)

  const refresh = useCallback(async () => setBooks(await listBooks()), [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const state = (b: BookRecord) => (isFinished(b) ? 'finished' : b.fraction ? 'reading' : 'unread')
    const list = books.filter(
      (b) =>
        (filter === 'all' || state(b) === filter) &&
        (!q || `${b.title} ${b.author} ${b.fileName}`.toLowerCase().includes(q)),
    )
    const by = (f: (b: BookRecord) => string) => (a: BookRecord, b: BookRecord) =>
      f(a).localeCompare(f(b), 'he')
    if (sort === 'title') list.sort(by((b) => b.title))
    else if (sort === 'author') list.sort(by((b) => b.author || '￿'))
    else if (sort === 'added') list.sort((a, b) => b.addedAt - a.addedAt)
    return list // 'recent' keeps the order listBooks returns
  }, [books, query, sort, filter])

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

  const doExport = async () => {
    setError(undefined)
    try {
      setBusy('מכין גיבוי…')
      const blob = await exportLibrary((d, t) => setBusy(`מכין גיבוי… ${d}/${t}`))
      download(blob, `גיבוי-ספרייה-${new Date().toISOString().slice(0, 10)}.readerbackup`)
      markBackedUp()
      setRemind(false)
    } catch (e) {
      setError(`גיבוי נכשל: ${e instanceof Error ? e.message : String(e)}`)
    }
    setBusy(undefined)
  }

  const doImport = async (file: File) => {
    setError(undefined)
    try {
      setBusy('משחזר גיבוי…')
      const n = await importLibrary(file, (d, t) => setBusy(`משחזר גיבוי… ${d}/${t}`))
      setBusy(undefined)
      alert(`שוחזרו ${n} ספרים.`)
    } catch (e) {
      setError(`שחזור נכשל: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(undefined)
    }
    await refresh()
  }

  const doSyncExport = async () => {
    setError(undefined)
    try {
      download(await exportSync(), `סנכרון-${new Date().toISOString().slice(0, 10)}.readersync`)
    } catch (e) {
      setError(`ייצוא נכשל: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const doSyncImport = async (file: File) => {
    setError(undefined)
    try {
      const r = await importSync(file)
      alert(
        `עודכנו ${r.moved} מיקומי קריאה, נוספו ${r.notes} הערות.` +
          (r.skipped ? `
${r.skipped} ספרים לא נמצאו במכשיר הזה ודולגו.` : ''),
      )
    } catch (e) {
      setError(`ייבוא נכשל: ${e instanceof Error ? e.message : String(e)}`)
    }
    await refresh()
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
        <button onClick={doExport} disabled={!!busy}>
          גיבוי
        </button>
        <button onClick={() => restoreInput.current?.click()} disabled={!!busy}>
          שחזור
        </button>
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
        <button onClick={doSyncExport} disabled={!!busy} title="מיקום קריאה והערות בלבד, קובץ קטן">
          ייצוא התקדמות
        </button>
        <button onClick={() => syncInput.current?.click()} disabled={!!busy}>
          ייבוא התקדמות
        </button>
        <input
          ref={syncInput}
          type="file"
          hidden
          accept=".readersync,application/json"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) doSyncImport(f)
            e.target.value = ''
          }}
        />
      </header>

      {remind && books.length > 0 && (
        <div className="notice" onClick={() => setRemind(false)}>
          עברו יותר משבועיים בלי גיבוי. הדפדפן עלול למחוק את הספרייה — לחץ על ״גיבוי״ לשמירת עותק.
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
                onClick={async () => {
                  if (confirm(`למחוק את ״${b.title}״ מהספרייה?`)) {
                    await deleteBook(b.id)
                    refresh()
                  }
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
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
