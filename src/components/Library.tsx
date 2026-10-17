import { useEffect, useMemo, useRef, useState } from 'react'
import { isFinished, updateMeta, type BookMeta } from '../lib/db'
import { backupDue } from '../lib/backupReminder'
import { getStorageStatus, requestPersistence, type StorageStatus } from '../lib/storage'
import { useToast } from '../hooks/useToast'
import { useSelection } from '../hooks/useSelection'
import { useLibrary } from '../hooks/useLibrary'
import { useImport } from '../hooks/useImport'
import { useFolders } from '../hooks/useFolders'
import { useBackup } from '../hooks/useBackup'
import { useAutoBackup } from '../hooks/useAutoBackup'
import { useUpdateCheck } from '../hooks/useUpdateCheck'
import { useConfirm } from '../hooks/useConfirm'
import { GoalsDialog } from './library/GoalsDialog'
import { BackupMenu } from './library/BackupMenu'
import { LibTools, type Filter, type Sort } from './library/LibTools'
import { BookGrid } from './library/BookGrid'
import { Cover } from './library/Cover'
import { FolderBar, FolderList } from './library/FolderBar'
import {
  ConfirmDeleteDialog,
  ConfirmDialog,
  DuplicateAskDialog,
  DuplicateBatchDialog,
  EditBookDialog,
  FolderNameDialog,
  MoveDialog,
  PasswordDialog,
} from './library/Dialogs'

export default function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [drag, setDrag] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<BookMeta>()
  const [editTitle, setEditTitle] = useState('')
  const [editAuthor, setEditAuthor] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const restoreInput = useRef<HTMLInputElement>(null)
  const [storage, setStorage] = useState<StorageStatus>()
  const [dismissed, setDismissed] = useState(false)
  const reqPersist = async () => {
    const ok = await requestPersistence()
    setStorage(await getStorageStatus())
    showToast(ok ? 'האחסון הוגדר כקבוע' : 'הדפדפן לא אישר אחסון קבוע. גיבוי הוא ההגנה הבטוחה על הספרייה')
  }
  const [goalsOpen, setGoalsOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState<BookMeta[]>()
  useEffect(() => {
    getStorageStatus().then(setStorage)
  }, [])

  const { toast, showToast, clearToast } = useToast()
  const selection = useSelection()
  const { selecting, setSelecting, selected, setSelected, selectedFolders, setSelectedFolders, exitSelect } = selection
  const { books, createdNames, refresh, deleteBooks } = useLibrary(setError, { showToast, clearToast })
  const { pending: confirmAsk, confirm } = useConfirm()
  const imp = useImport({ refresh, setBusy, setError })
  const backup = useBackup({ refresh, setBusy, setError, showToast, onBackedUp: () => setDismissed(true), confirm })
  const checkUpdate = useUpdateCheck({ setBusy, setError, showToast, confirm })
  const auto = useAutoBackup({ setError, showToast })

  // without persistent storage the browser may evict the library, so remind sooner
  const unprotected = storage ? !storage.persisted : false
  const remind = useMemo(() => !dismissed && backupDue(unprotected), [dismissed, unprotected])

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

  // searching looks through every folder at once
  const searching = !!query.trim()
  const fo = useFolders({ books, shown, createdNames, searching, refresh, showToast, exitSelect, deleteBooks, confirm })
  const { folders, current } = fo
  const inFolderList = !searching && !current
  const pickedFolders = folders.filter((f) => selectedFolders.has(f.key))

  // the book opened last that is still in progress, offered as a one-tap way back
  const resume = useMemo(() => {
    if (selecting || query.trim() || filter !== 'all') return undefined
    let best: BookMeta | undefined
    for (const b of books) {
      if (!b.fraction || isFinished(b) || !b.lastOpened) continue
      if (!best || b.lastOpened > best.lastOpened!) best = b
    }
    return best
  }, [books, selecting, query, filter])

  const doDelete = async () => {
    const list = confirmDel
    if (!list) return
    setConfirmDel(undefined)
    await deleteBooks(list)
    exitSelect()
  }

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

  const { batch, now } = imp

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
        imp.addFiles(e.dataTransfer.files)
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
          accept=".epub,.pdf,.txt,.docx,.mobi,.azw,.azw3,.fb2,.fbz,.cbz,application/epub+zip,application/pdf,text/plain"
          onChange={(e) => {
            if (e.target.files) imp.addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <BackupMenu
          view={
            books.length > 0
              ? {
                  onNewFolder: inFolderList ? () => fo.setFolderDialog({ name: '' }) : undefined,
                  selecting,
                  onToggleSelect: () => (selecting ? exitSelect() : setSelecting(true)),
                }
              : undefined
          }
          busy={!!busy}
          storage={storage}
          onPersist={reqPersist}
          onBackup={backup.askExport}
          onRestore={() => restoreInput.current?.click()}
          onCheckUpdate={checkUpdate}
          onGoals={() => setGoalsOpen(true)}
          auto={{ state: auto.state, last: auto.last, onEnable: auto.enable, onDisable: auto.disable, onRenew: auto.renew }}
        />
        <input
          ref={restoreInput}
          type="file"
          hidden
          accept=".readerbackup"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) backup.doImport(f)
            e.target.value = ''
          }}
        />
      </header>

      {remind && books.length > 0 && (
        <div className={'notice closable' + (unprotected ? ' error' : '')}>
          <span>
            {unprotected
              ? 'הדפדפן לא אישר אחסון קבוע, והספרייה עלולה להימחק בכל רגע. עברו כמה ימים בלי גיבוי — ב־⋯ בחר ״גיבוי״ לשמירת עותק.'
              : 'עברו יותר משבועיים בלי גיבוי. הדפדפן עלול למחוק את הספרייה — ב־⋯ בחר ״גיבוי״ לשמירת עותק.'}
          </span>
          <button className="notice-close" aria-label="סגור" onClick={() => setDismissed(true)}>✕</button>
        </div>
      )}

      {resume && (
        <button className="continue" onClick={() => onOpen(resume.id)}>
          <Cover book={resume} />
          <span className="continue-info">
            <small>המשך לקרוא</small>
            <strong>{resume.title}</strong>
            {resume.author && <small>{resume.author}</small>}
            <progress value={resume.fraction} max={1} aria-label={`${Math.round((resume.fraction ?? 0) * 100)}% נקרא`} />
          </span>
          <span className="continue-cta">המשך</span>
        </button>
      )}

      {books.length > 1 && (
        <LibTools query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} sort={sort} onSort={setSort} />
      )}

      {selecting && (
        <div className="notice select-bar">
          {inFolderList ? (<>
            <span>{selectedFolders.size} תיקיות נבחרו</span>
            <button onClick={() => setSelectedFolders(new Set(folders.map((f) => f.key)))}>בחר כל התיקיות</button>
            <button
              className="danger"
              disabled={pickedFolders.length === 0}
              onClick={() => fo.deleteFolders(pickedFolders)}
            >
              מחק תיקיות
            </button>
          </>) : (<>
            <span>{selected.size} ספרים נבחרו</span>
            <button onClick={() => setSelected(new Set((searching ? shown : current!.books).map((b) => b.id)))}>בחר כל הספרים</button>
            <button disabled={selected.size === 0} onClick={() => fo.setMoving(books.filter((b) => selected.has(b.id)))}>
              העבר ספרים
            </button>
            <button
              className="danger"
              disabled={selected.size === 0}
              onClick={() => setConfirmDel(books.filter((b) => selected.has(b.id)))}
            >
              מחק ספרים
            </button>
          </>)}
          <button onClick={exitSelect}>סיום</button>
        </div>
      )}

      {busy && (
        <div className="notice">
          {batch && (
            <div className="batch">
              <div className="batch-head">
                <span>
                  {batch.done}/{batch.total} ספרים
                </span>
                <span>
                  {batch.deadline === undefined
                    ? 'מחשב זמן…'
                    : `נותרו כ-${Math.max(0, Math.ceil((batch.deadline - now) / 1000))} שניות`}
                </span>
              </div>
              <progress value={batch.done} max={batch.total} />
            </div>
          )}
          {busy}
        </div>
      )}
      {error && (
        <div className="notice error closable" role="alert">
          <span>{error}</span>
          <button className="notice-close" aria-label="סגור" onClick={() => setError(undefined)}>✕</button>
        </div>
      )}

      {books.length === 0 && !busy ? (
        <div className="empty">
          <p>אין עדיין ספרים.</p>
          <p>לחץ על ״הוסף ספר״ ובחר קובץ EPUB, PDF, MOBI, AZW3, FB2, CBZ, DOCX או TXT מהטלפון או מגוגל דרייב.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <p>{query ? `לא נמצאו ספרים עבור ״${query}״.` : 'אין ספרים בסינון הזה.'}</p>
        </div>
      ) : inFolderList ? (
        <FolderList
          folders={folders}
          loose={fo.loose}
          bookActions={{
            onOpen,
            onEdit: openEdit,
            onMove: (b) => fo.setMoving([b]),
            onDelete: (b) => setConfirmDel([b]),
            refresh,
          }}
          selecting={selecting}
          selectedFolders={selectedFolders}
          onOpen={fo.setOpenFolder}
          onToggle={selection.toggleFolder}
        />
      ) : (
        <>
          {current && !searching && (
            <FolderBar
              folder={current}
              onBack={folders.length > 1 ? () => fo.setOpenFolder(undefined) : undefined}
              onRename={() => fo.setFolderDialog({ rename: current.name, name: current.name })}
              onDelete={() => fo.deleteFolders([current])}
            />
          )}
          {current && !current.books.length && !searching && (
            <div className="empty"><p>התיקייה ריקה. העבירו אליה ספרים עם 📁.</p></div>
          )}
          <BookGrid
            books={searching ? shown : current!.books}
            selecting={selecting}
            selected={selected}
            onOpen={onOpen}
            onToggle={selection.toggleSelect}
            onEdit={openEdit}
            onMove={(b) => fo.setMoving([b])}
            onDelete={(b) => setConfirmDel([b])}
            refresh={refresh}
          />
        </>
      )}

      {toast && (
        <div className="lib-toast" role="status">
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={toast.undo}>בטל</button>}
        </div>
      )}

      {imp.dupBatch && (
        <DuplicateBatchDialog
          batch={imp.dupBatch}
          detail={imp.dupDetail}
          onDetail={() => imp.setDupDetail(true)}
          onChange={imp.setDupBatch}
        />
      )}
      {imp.dupAsk && <DuplicateAskDialog ask={imp.dupAsk} onDone={() => imp.setDupAsk(undefined)} />}
      {confirmDel && (
        <ConfirmDeleteDialog books={confirmDel} onConfirm={doDelete} onCancel={() => setConfirmDel(undefined)} />
      )}
      {fo.moving && (
        <MoveDialog
          books={fo.moving}
          folders={fo.allFolders}
          newFolder={fo.newFolder}
          onNewFolder={fo.setNewFolder}
          onMove={(name, created) => fo.moveTo(fo.moving!, name, created)}
          onCancel={() => fo.setMoving(undefined)}
        />
      )}
      {fo.folderDialog && (
        <FolderNameDialog
          dialog={fo.folderDialog}
          onChange={fo.setFolderDialog}
          onSave={fo.saveFolderDialog}
          onCancel={() => fo.setFolderDialog(undefined)}
        />
      )}
      {backup.pwAsk && (
        <PasswordDialog
          ask={backup.pwAsk}
          pw={backup.pw}
          onPw={backup.setPw}
          onSubmit={backup.submitPw}
          onCancel={() => backup.setPwAsk(undefined)}
        />
      )}
      {confirmAsk && <ConfirmDialog ask={confirmAsk} />}
      {goalsOpen && <GoalsDialog onClose={() => setGoalsOpen(false)} />}
      {editing && (
        <EditBookDialog
          title={editTitle}
          author={editAuthor}
          onTitle={setEditTitle}
          onAuthor={setEditAuthor}
          onSave={saveEdit}
          onCancel={() => setEditing(undefined)}
        />
      )}
    </div>
  )
}
