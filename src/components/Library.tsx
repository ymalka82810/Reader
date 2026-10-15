import { Dropdown } from './Dropdown'
import { Dialog } from './Dialog'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { deleteBook, isFinished, listBooks, setFinished, updateMeta, type BookMeta } from '../lib/db'
import { importFile, type DuplicateChoice } from '../lib/importBook'
import { PasswordRequiredError, WrongPasswordError } from '../lib/encrypt'
import { backupDue, exportLibrary, exportLibraryTo, importLibrary, librarySize, markBackedUp } from '../lib/backup'
import { download } from '../lib/download'
import { onLaunchFiles, takeSharedFiles } from '../lib/inbox'
import { formatBytes, getStorageStatus, type StorageStatus } from '../lib/storage'

function Cover({ book }: { book: BookMeta }) {
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
    // oxlint-disable-next-line react/set-state-in-effect -- syncs an object URL, an external resource
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

/** above this, building the backup in memory risks crashing a phone */
const BIG_BACKUP = 500 * 1024 * 1024

export default function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const [books, setBooks] = useState<BookMeta[]>([])
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [drag, setDrag] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'title' | 'author' | 'added'>('recent')
  const [filter, setFilter] = useState<'all' | 'reading' | 'unread' | 'finished'>('all')
  const [editing, setEditing] = useState<BookMeta>()
  const [editTitle, setEditTitle] = useState('')
  const [editAuthor, setEditAuthor] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const restoreInput = useRef<HTMLInputElement>(null)
  const [storage, setStorage] = useState<StorageStatus>()
  const [dismissed, setDismissed] = useState(false)
  const [menu, setMenu] = useState(false)
  const [toast, setToast] = useState<{ msg: string; undo?: () => void }>()
  const toastTimer = useRef<number>(undefined)
  // multi-select mode and the delete confirmation
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState<BookMeta[]>()
  // a same-title book already exists: waits for the user's choice
  const [dupAsk, setDupAsk] = useState<{ file: string; existing: BookMeta; answer: (c: DuplicateChoice) => void }>()
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
    // oxlint-disable-next-line react/set-state-in-effect -- loads the library from IndexedDB
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

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const exitSelect = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const doDelete = async () => {
    const list = confirmDel
    if (!list) return
    setConfirmDel(undefined)
    try {
      for (const b of list) await deleteBook(b.id)
      showToast(list.length === 1 ? `״${list[0]?.title}״ נמחק` : `${list.length} ספרים נמחקו`)
    } catch (e) {
      setError(`מחיקה נכשלה: ${e instanceof Error ? e.message : String(e)}`)
    }
    exitSelect()
    await refresh()
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const state = (b: BookMeta) => (isFinished(b) ? 'finished' : b.fraction ? 'reading' : 'unread')
    const list = books.filter(
      (b) =>
        (filter === 'all' || state(b) === filter) &&
        (!q || `${b.title} ${b.author} ${b.fileName}`.toLowerCase().includes(q)),
    )
    const by = (f: (b: BookMeta) => string) => (a: BookMeta, b: BookMeta) =>
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
        await importFile(
          f,
          setBusy,
          (existing) => new Promise<DuplicateChoice>((resolve) => setDupAsk({ file: f.name, existing, answer: resolve })),
        )
        await refresh() // show each book as soon as it's done
      } catch (e) {
        errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setBusy(undefined)
    if (errors.length) setError(errors.join('\n'))
    await refresh()
  }

  const addRef = useRef(addFiles)
  useLayoutEffect(() => {
    addRef.current = addFiles
  })
  useEffect(() => {
    takeSharedFiles().then((f) => {
      if (f.length) addRef.current(f)
    })
    onLaunchFiles((f) => addRef.current(f))
  }, [])

  const doExport = async (password?: string) => {
    setError(undefined)
    const name = `גיבוי-ספרייה-${new Date().toISOString().slice(0, 10)}.readerbackup`
    try {
      // must run first: the save dialog needs the click's user activation, which awaits can use up
      const picker = (window as any).showSaveFilePicker as undefined | ((o: object) => Promise<any>)
      let sink: any
      if (picker) {
        try {
          sink = await (await picker({ suggestedName: name })).createWritable()
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return
          /* picker unavailable here: fall back to an in-memory download */
        }
      }
      if (!sink) {
        const size = await librarySize()
        if (size > BIG_BACKUP && !confirm(`הספרייה גדולה (${Math.round(size / 1024 / 1024)}MB). הגיבוי נבנה בזיכרון ועלול להיכשל במכשיר חלש. להמשיך?`)) return
      }
      setBusy('מכין גיבוי…')
      const progress = (d: number, t: number) => setBusy(`מכין גיבוי… ${d}/${t}`)
      if (sink) await exportLibraryTo(sink, progress, password)
      else download(await exportLibrary(progress, password), name)
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

  const pickRestore = () => restoreInput.current?.click()

  const openEdit = (b: BookMeta) => {
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
                {/* oxlint-disable-next-line react/refs -- only read when the menu item is clicked */}
                {(
                  // oxlint-disable-next-line react/refs -- only read when the menu item is clicked
                  [
                    ['גיבוי', () => { setPw(''); setPwAsk({ kind: 'export' }) }, 'ספרים, מיקום קריאה, הערות והגדרות (אפשר להצפין בסיסמה)'],
                    ['שחזור', pickRestore, 'מוסיף ספרים חסרים וממזג מיקום והערות'],
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

      {books.length > 0 && (
        <div className="lib-tools">
          {books.length > 1 && (<>
          <input
            type="search"
            placeholder="חיפוש לפי שם או מחבר…"
            aria-label="חיפוש בספרייה"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Dropdown
            label="סינון"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'הכול' },
              { value: 'reading', label: 'בקריאה' },
              { value: 'unread', label: 'לא התחלתי' },
              { value: 'finished', label: 'נקראו' },
            ]}
          />
          <Dropdown
            label="מיון"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'recent', label: 'נפתח לאחרונה' },
              { value: 'added', label: 'נוסף לאחרונה' },
              { value: 'title', label: 'שם (א–ת)' },
              { value: 'author', label: 'מחבר (א–ת)' },
            ]}
          />
          </>)}
          <button onClick={() => (selecting ? exitSelect() : setSelecting(true))} aria-pressed={selecting}>
            {selecting ? 'סיום' : 'בחירה'}
          </button>
        </div>
      )}

      {selecting && (
        <div className="notice select-bar">
          <span>{selected.size} נבחרו</span>
          <button onClick={() => setSelected(new Set(shown.map((b) => b.id)))}>בחר הכול</button>
          <button
            className="danger"
            disabled={selected.size === 0}
            onClick={() => setConfirmDel(books.filter((b) => selected.has(b.id)))}
          >
            מחק
          </button>
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
              <button
                className={'card' + (selected.has(b.id) ? ' selected' : '')}
                aria-pressed={selecting ? selected.has(b.id) : undefined}
                onClick={() => (selecting ? toggleSelect(b.id) : onOpen(b.id))}
              >
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
              {selecting ? (
                <span className="sel-mark" aria-hidden="true">{selected.has(b.id) ? '☑' : '☐'}</span>
              ) : (
                <>
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
                  <button className="del" aria-label="מחק" onClick={() => setConfirmDel([b])}>
                    ✕
                  </button>
                </>
              )}
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

      {dupAsk && (
        <div className="modal-backdrop">
          <Dialog className="modal" role="alertdialog" aria-modal="true" aria-label="הספר כבר קיים">
            <h2>הספר כבר קיים בספרייה</h2>
            <p>
              ״{dupAsk.existing.title}״ כבר בספרייה. להחליף אותו בקובץ {dupAsk.file}? החלפה תמחק את הגרסה הקיימת יחד
              עם מיקום הקריאה וההערות שלה.
            </p>
            <div className="modal-actions">
              <button
                className="danger"
                onClick={() => {
                  dupAsk.answer('replace')
                  setDupAsk(undefined)
                }}
              >
                החלף
              </button>
              <button
                onClick={() => {
                  dupAsk.answer('add')
                  setDupAsk(undefined)
                }}
              >
                הוסף בכל זאת
              </button>
              <button
                onClick={() => {
                  dupAsk.answer('skip')
                  setDupAsk(undefined)
                }}
                autoFocus
              >
                דלג
              </button>
            </div>
          </Dialog>
        </div>
      )}

      {confirmDel && (
        <div className="modal-backdrop" onClick={() => setConfirmDel(undefined)}>
          <Dialog
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-label="אישור מחיקה"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setConfirmDel(undefined)}
          >
            <h2>למחוק {confirmDel.length === 1 ? 'את הספר' : `${confirmDel.length} ספרים`}?</h2>
            <p>
              {confirmDel.length === 1
                ? `״${confirmDel[0]?.title}״ יימחק יחד עם מיקום הקריאה וההערות שלו.`
                : 'הספרים שנבחרו יימחקו יחד עם מיקום הקריאה וההערות שלהם.'}{' '}
              אי אפשר לבטל פעולה זו.
            </p>
            <div className="modal-actions">
              <button className="danger" onClick={doDelete}>מחק</button>
              <button onClick={() => setConfirmDel(undefined)} autoFocus>ביטול</button>
            </div>
          </Dialog>
        </div>
      )}

      {pwAsk && (
        <div className="modal-backdrop" onClick={() => setPwAsk(undefined)}>
          <Dialog
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
          </Dialog>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(undefined)}>
          <Dialog
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
          </Dialog>
        </div>
      )}
    </div>
  )
}
