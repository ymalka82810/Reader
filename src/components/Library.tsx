import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteBook, listBooks, type BookRecord } from '../lib/db'
import { importFile } from '../lib/importBook'
import { exportLibrary, importLibrary } from '../lib/backup'

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
  const input = useRef<HTMLInputElement>(null)
  const restoreInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => setBooks(await listBooks()), [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const addFiles = async (files: FileList | File[]) => {
    setError(undefined)
    for (const f of Array.from(files)) {
      try {
        setBusy(`מוסיף את ${f.name}…`)
        await importFile(f, setBusy)
      } catch (e) {
        setError(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setBusy(undefined)
    await refresh()
  }

  const doExport = async () => {
    setError(undefined)
    try {
      setBusy('מכין גיבוי…')
      const blob = await exportLibrary((d, t) => setBusy(`מכין גיבוי… ${d}/${t}`))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `גיבוי-ספרייה-${new Date().toISOString().slice(0, 10)}.readerbackup`
      a.click()
      URL.revokeObjectURL(url)
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
          accept=".epub,.pdf,application/epub+zip,application/pdf"
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
      </header>

      {busy && <div className="notice">{busy}</div>}
      {error && (
        <div className="notice error" onClick={() => setError(undefined)}>
          {error}
        </div>
      )}

      {books.length === 0 && !busy ? (
        <div className="empty">
          <p>אין עדיין ספרים.</p>
          <p>לחץ על ״הוסף ספר״ ובחר קובץ EPUB או PDF מהטלפון או מגוגל דרייב.</p>
        </div>
      ) : (
        <ul className="grid">
          {books.map((b) => (
            <li key={b.id}>
              <button className="card" onClick={() => onOpen(b.id)}>
                <Cover book={b} />
                <div className="meta">
                  <strong>{b.title}</strong>
                  {b.author && <small>{b.author}</small>}
                  <small className="kind">
                    {b.fromPdf ? 'PDF' : b.kind.toUpperCase()}
                    {b.fraction ? ` · ${Math.round(b.fraction * 100)}%` : ''}
                  </small>
                </div>
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
    </div>
  )
}
