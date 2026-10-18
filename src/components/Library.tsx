import { useEffect, useMemo, useRef, useState } from 'react'
import { getAllNotes, getFile, isFinished, updateMeta, type Annotation, type BookMeta } from '../lib/db'
import { searchNotes } from '../lib/noteSearch'
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
import { hasTag, listTags, parseTags } from '../lib/tags'
import { localeTag, t } from '../i18n'
import { GoalsDialog } from './library/GoalsDialog'
import { ReviewDialog } from './library/ReviewDialog'
import { BackupMenu } from './library/BackupMenu'
import { SettingsScreen } from './settings/SettingsScreen'
import { LibTools, type Sort } from './library/LibTools'
import { CatalogDialog } from './library/CatalogDialog'
import { PickBooksDialog } from './library/PickBooksDialog'
import { bookType, byLength, isFiltering, isStale, longestOf, NO_FILTER, typesOf, type LibraryFilter } from '../lib/libraryFilter'
import { folderKey, groupFolders } from '../lib/folders'
import { BookGrid } from './library/BookGrid'
import { NoteHits } from './library/NoteHits'
import { ResumeCarousel } from './library/ResumeCarousel'
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

export default function Library({ onOpen }: { onOpen: (id: string, cfi?: string) => void }) {
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [drag, setDrag] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [loadedAt] = useState(Date.now)
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER)
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<BookMeta>()
  const [editTitle, setEditTitle] = useState('')
  const [editAuthor, setEditAuthor] = useState('')
  const [editTags, setEditTags] = useState('')
  const [tag, setTag] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const restoreInput = useRef<HTMLInputElement>(null)
  const [storage, setStorage] = useState<StorageStatus>()
  const [dismissed, setDismissed] = useState(false)
  const reqPersist = async () => {
    const ok = await requestPersistence()
    setStorage(await getStorageStatus())
    showToast(ok ? t('lib.persistOk') : t('lib.persistDenied'))
  }
  const [goalsOpen, setGoalsOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const tags = useMemo(() => listTags(books), [books])
  // a tag that no book carries any more stops filtering
  const activeTag = tags.some((x) => x.key === tag) ? tag : ''

  // file sizes stand in for book length; they are read only once "longest" is asked for
  const needSizes = sort === 'longest' || filter.smart === 'longest'
  const [sizes, setSizes] = useState<ReadonlyMap<string, number>>(new Map())
  useEffect(() => {
    if (!needSizes) return
    let alive = true
    Promise.all(books.map(async (b) => [b.id, (await getFile(b.id))?.size ?? 0] as const))
      .then((e) => alive && setSizes(new Map(e)))
      .catch(console.error)
    return () => {
      alive = false
    }
  }, [needSizes, books])

  // books passing the filter and tag pickers, before the text query
  const scoped = useMemo(() => {
    const now = loadedAt
    const longest = filter.smart === 'longest' ? longestOf(books, sizes) : undefined
    const state = (b: BookMeta) => (isFinished(b) ? 'finished' : b.fraction ? 'reading' : 'unread')
    return books.filter(
      (b) =>
        (filter.state === 'all' || state(b) === filter.state) &&
        (!filter.type || bookType(b) === filter.type) &&
        (filter.folder === undefined || folderKey(b) === filter.folder) &&
        (!filter.ids.size || filter.ids.has(b.id)) &&
        (!activeTag || hasTag(b, activeTag)) &&
        (filter.smart !== 'stale' || isStale(b, now)) &&
        (!longest || longest.has(b.id)),
    )
  }, [books, filter, activeTag, sizes, loadedAt])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = scoped.filter(
      (b) =>
        (!q || `${b.title} ${b.author} ${b.fileName} ${(b.tags ?? []).join(' ')}`.toLowerCase().includes(q)),
    )
    const by = (f: (b: BookMeta) => string) => (a: BookMeta, b: BookMeta) =>
      f(a).localeCompare(f(b), localeTag())
    if (sort === 'title') list.sort(by((b) => b.title))
    else if (sort === 'author') list.sort(by((b) => b.author || '￿'))
    else if (sort === 'added') list.sort((a, b) => b.addedAt - a.addedAt)
    else if (sort === 'longest') list.sort(byLength(sizes))
    return list // 'recent' keeps the order listBooks returns
  }, [scoped, query, sort, sizes])

  // highlights and notes of every book are read once a search starts, and searched along with the titles
  const searchingText = !!query.trim()
  const [allNotes, setAllNotes] = useState<Map<string, Annotation[]>>()
  useEffect(() => {
    if (!searchingText) return
    let alive = true
    getAllNotes()
      .then((m) => alive && setAllNotes(m))
      .catch(console.error)
    return () => {
      alive = false
    }
  }, [searchingText])
  const noteHits = useMemo(
    () => (searchingText && allNotes ? searchNotes(scoped, allNotes, query) : []),
    [scoped, allNotes, query, searchingText],
  )

  const types = useMemo(() => typesOf(books), [books])
  const filterFolders = useMemo(() => groupFolders(books), [books])

  // searching or filtering by tag looks through every folder at once
  const searching = !!query.trim() || !!activeTag
  const fo = useFolders({ books, shown, createdNames, searching, refresh, showToast, exitSelect, deleteBooks, confirm })
  const { folders, current } = fo
  const inFolderList = !searching && !current
  const pickedFolders = folders.filter((f) => selectedFolders.has(f.key))

  // books still in progress, last opened first, offered as a one-tap way back
  const resume = useMemo(() => {
    if (selecting || query.trim() || isFiltering(filter) || activeTag) return []
    return books
      .filter((b) => b.fraction && !isFinished(b) && b.lastOpened)
      .sort((a, b) => b.lastOpened! - a.lastOpened!)
  }, [books, selecting, query, filter, activeTag])

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
    setEditTags((b.tags ?? []).join(', '))
  }

  const saveEdit = async () => {
    if (!editing) return
    const title = editTitle.trim()
    if (!title) return
    await updateMeta(editing.id, title, editAuthor.trim(), parseTags(editTags))
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
      <a
        className="skip-link"
        href="#lib-content"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('lib-content')?.focus()
        }}
      >
        {t('a11y.skip')}
      </a>
      <header className="lib-header">
        <button className="prefs-open" aria-label={t('prefs.open')} title={t('prefs.open')} onClick={() => setSettingsOpen(true)}>
          ☰
        </button>
        <h1>{t('lib.title')}</h1>
        <button className="primary" onClick={() => input.current?.click()} disabled={!!busy}>
          {t('lib.addBook')}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept=".epub,.pdf,.txt,.docx,.mobi,.azw,.azw3,.fb2,.fbz,.cbz,.m4b,.mp3,.m4a,.ogg,.opus,.flac,.wav,application/epub+zip,application/pdf,text/plain,audio/*"
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
          onBackup={backup.askExport}
          onRestore={() => restoreInput.current?.click()}
          onGoals={() => setGoalsOpen(true)}
          onReview={() => setReviewOpen(true)}
          onCatalog={() => setCatalogOpen(true)}
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

      <main id="lib-content" tabIndex={-1}>

      {remind && books.length > 0 && (
        <div className={'notice closable' + (unprotected ? ' error' : '')}>
          <span>
            {unprotected ? t('lib.remindUnprotected') : t('lib.remindOverdue')}
          </span>
          <button className="notice-close" aria-label={t('common.close')} onClick={() => setDismissed(true)}>✕</button>
        </div>
      )}

      {resume.length > 0 && <ResumeCarousel books={resume} onOpen={(id) => onOpen(id)} />}

      {books.length > 1 && (
        <LibTools
          query={query}
          onQuery={setQuery}
          filter={filter}
          onFilter={setFilter}
          types={types}
          folders={filterFolders}
          onPickBooks={() => setPicking(true)}
          sort={sort}
          onSort={setSort}
          tags={tags}
          tag={activeTag}
          onTag={setTag}
        />
      )}

      {selecting && (
        <div className="notice select-bar">
          {inFolderList ? (<>
            <span>{t('lib.foldersSelected', { n: selectedFolders.size })}</span>
            <button onClick={() => setSelectedFolders(new Set(folders.map((f) => f.key)))}>{t('lib.selectAllFolders')}</button>
            <button
              className="danger"
              disabled={pickedFolders.length === 0}
              onClick={() => fo.deleteFolders(pickedFolders)}
            >
              {t('lib.deleteFolders')}
            </button>
          </>) : (<>
            <span>{t('lib.booksSelected', { n: selected.size })}</span>
            <button onClick={() => setSelected(new Set((searching ? shown : current!.books).map((b) => b.id)))}>{t('lib.selectAllBooks')}</button>
            <button disabled={selected.size === 0} onClick={() => fo.setMoving(books.filter((b) => selected.has(b.id)))}>
              {t('lib.moveBooks')}
            </button>
            <button
              className="danger"
              disabled={selected.size === 0}
              onClick={() => setConfirmDel(books.filter((b) => selected.has(b.id)))}
            >
              {t('lib.deleteBooks')}
            </button>
          </>)}
          <button onClick={exitSelect}>{t('common.done')}</button>
        </div>
      )}

      {busy && (
        <div className="notice">
          {batch && (
            <div className="batch">
              <div className="batch-head">
                <span>
                  {t('lib.batchProgress', { done: batch.done, total: batch.total })}
                </span>
                <span>
                  {batch.deadline === undefined
                    ? t('lib.batchEstimating')
                    : t('lib.batchRemaining', { n: Math.max(0, Math.ceil((batch.deadline - now) / 1000)) })}
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
          <button className="notice-close" aria-label={t('common.close')} onClick={() => setError(undefined)}>✕</button>
        </div>
      )}

      {books.length === 0 && !busy ? (
        <div className="empty">
          <p>{t('lib.empty')}</p>
          <p>{t('lib.emptyHint')}</p>
        </div>
      ) : shown.length === 0 ? (
        noteHits.length === 0 && (
          <div className="empty">
            <p>{query ? t('lib.noMatch', { query }) : t('lib.noMatchFilter')}</p>
          </div>
        )
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
            <div className="empty"><p>{t('lib.folderEmpty')}</p></div>
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

      {!selecting && <NoteHits hits={noteHits} onOpen={onOpen} />}

      {toast && (
        <div className="lib-toast" role="status">
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={toast.undo}>{t('common.undo')}</button>}
        </div>
      )}

      </main>

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
      {picking && (
        <PickBooksDialog
          books={books}
          picked={filter.ids}
          onDone={(ids) => {
            setFilter({ ...filter, ids })
            setPicking(false)
          }}
          onCancel={() => setPicking(false)}
        />
      )}
      {confirmAsk &&<ConfirmDialog ask={confirmAsk} />}
      {settingsOpen && (
        <SettingsScreen
          onClose={() => setSettingsOpen(false)}
          onCheckUpdate={checkUpdate}
          backup={{
            busy: !!busy,
            storage,
            onPersist: reqPersist,
            onBackup: backup.askExport,
            onRestore: () => restoreInput.current?.click(),
            auto: { state: auto.state, last: auto.last, onEnable: auto.enable, onDisable: auto.disable, onRenew: auto.renew },
          }}
        />
      )}
      {goalsOpen && <GoalsDialog onClose={() => setGoalsOpen(false)} />}
      {catalogOpen && <CatalogDialog onClose={() => setCatalogOpen(false)} onAdd={(f) => imp.addFiles([f])} />}
      {reviewOpen && <ReviewDialog books={books} onClose={() => setReviewOpen(false)} />}
      {editing && (
        <EditBookDialog
          title={editTitle}
          author={editAuthor}
          tags={editTags}
          knownTags={tags.map((x) => x.name)}
          onTitle={setEditTitle}
          onAuthor={setEditAuthor}
          onTags={setEditTags}
          onSave={saveEdit}
          onCancel={() => setEditing(undefined)}
        />
      )}
    </div>
  )
}
