import { useEffect, useMemo, useRef, useState } from 'react'
import { getAllNotes, getFile, isFinished, setWords, updateMeta, type Annotation, type BookMeta } from '../lib/db'
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
import { useDeviceScan } from '../hooks/useDeviceScan'
import { deviceBooksSupported } from '../lib/deviceBooks'
import { autoSyncPhoneNames, phoneFileOf, saveBookToPhone, syncPhoneNames } from '../lib/phoneFiles'
import { formatBookName, splitBookName, type BookName } from '../lib/bookName'
import { identifyBook } from '../lib/bookLookup'
import { openingLines } from '../lib/bookText'
import { hasConsent, setConsent, SERVICE_HOST } from '../lib/consent'
import { IdentifyDialog, type NameChange } from './library/IdentifyDialog'
import { loadSettings } from '../lib/settings'
import { exitApp, useBackGesture } from '../hooks/useBackGesture'
import { useConfirm } from '../hooks/useConfirm'
import { hasTag, listTags, parseTags } from '../lib/tags'
import { localeTag, t } from '../i18n'
import { GoalsDialog } from './library/GoalsDialog'
import { ReviewDialog } from './library/ReviewDialog'
import { BackupMenu } from './library/BackupMenu'
import { SettingsScreen, type PageId } from './settings/SettingsScreen'
import { forgetSettings, rememberedSettings } from './settings/remember'
import { LibSearch, LibTools, type Sort } from './library/LibTools'
import { PickBooksDialog } from './library/PickBooksDialog'
import { wordsOfFile } from '../lib/wordCount'
import { bookType, byLength, isFiltering, isStale, longestOf, NO_FILTER, typesOf, type LibraryFilter } from '../lib/libraryFilter'
import { folderKey, groupFolders } from '../lib/folders'
import { remainingText } from '../lib/formatDuration'
import { BookGrid } from './library/BookGrid'
import { readFoldersFirst, readListView, saveFoldersFirst, saveListView } from '../lib/listView'
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

type Props = {
  onOpen: (id: string, cfi?: string) => void
  /** open the settings screen on this page right away (the reader's link to the full settings) */
  startSettings?: PageId
  onSettingsClosed?: () => void
}

export default function Library({ onOpen, startSettings, onSettingsClosed }: Props) {
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [drag, setDrag] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [loadedAt] = useState(Date.now)
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER)
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<BookMeta>()
  const [editName, setEditName] = useState<BookName>({ series: '', number: '', title: '' })
  const [editLookup, setEditLookup] = useState<{ busy: boolean; note?: string }>({ busy: false })
  const [editError, setEditError] = useState<string>()
  /** counts the edit dialogs opened, so a lookup that ends after its dialog closed changes nothing */
  const editRun = useRef(0)
  const [identifying, setIdentifying] = useState<{ books: BookMeta[]; online: boolean }>()
  const [editAuthor, setEditAuthor] = useState('')
  const [editTags, setEditTags] = useState('')
  /** the book has a file on the phone that can be renamed along with it; undefined = not known (or not an Android app) */
  const [editPhone, setEditPhone] = useState(false)
  const [editSync, setEditSync] = useState(true)
  const [tag, setTag] = useState('')
  const [list, setList] = useState(readListView)
  const changeList = (v: boolean) => {
    setList(v)
    saveListView(v)
  }
  const [foldersFirst, setFoldersFirst] = useState(readFoldersFirst)
  const changeFoldersFirst = (v: boolean) => {
    setFoldersFirst(v)
    saveFoldersFirst(v)
  }
  const input = useRef<HTMLInputElement>(null)
  const header = useRef<HTMLElement>(null)
  // the search box pins right under the header, whose height varies with the safe area
  useEffect(() => {
    const el = header.current
    if (!el) return
    const set = () => el.parentElement?.style.setProperty('--lib-header-h', el.offsetHeight + 'px')
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
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
  const [settingsOpen, setSettingsOpen] = useState(() => !!startSettings || rememberedSettings() !== null)
  const [settingsPage, setSettingsPage] = useState(startSettings)
  const [confirmDel, setConfirmDel] = useState<BookMeta[]>()
  useEffect(() => {
    getStorageStatus().then(setStorage)
  }, [])

  const { toast, showToast, clearToast } = useToast()
  const selection = useSelection()
  const { selecting, setSelecting, selected, setSelected, selectedFolders, setSelectedFolders, exitSelect } = selection
  const { books, createdNames, refresh, deleteBooks } = useLibrary(setError, { showToast, clearToast })
  const { pending: confirmAsk, confirm } = useConfirm()
  // the phone's back swipe in the library: dismisses an open question, else asks before leaving the app
  useBackGesture(() => {
    if (confirmAsk) {
      confirmAsk.answer(false)
      return
    }
    void confirm({ title: t('exit.title'), text: t('exit.text'), ok: t('exit.ok') }).then((yes) => yes && exitApp())
  })
  const imp = useImport({ refresh, setError, showToast })
  const backup = useBackup({ refresh, setBusy, setError, showToast, onBackedUp: () => setDismissed(true), confirm })
  const checkUpdate = useUpdateCheck({ setBusy, setError, showToast, confirm })
  const scanDevice = useDeviceScan({ addFiles: imp.addFiles, setBusy, setError, showToast, confirm })
  const auto = useAutoBackup({ setError, showToast })

  // without persistent storage the browser may evict the library, so remind sooner
  const unprotected = storage ? !storage.persisted : false
  // read on every render: it is two localStorage reads, and the interval can change in the settings
  const remind = !dismissed && backupDue(unprotected)

  const tags = useMemo(() => listTags(books), [books])
  // a tag that no book carries any more stops filtering
  const activeTag = tags.some((x) => x.key === tag) ? tag : ''

  // books added before words were counted get their count the first time "longest" is asked for
  const needLengths = sort === 'longest' || filter.smart === 'longest'
  const lengths = useMemo(() => new Map(books.map((b) => [b.id, b.words ?? 0])), [books])
  useEffect(() => {
    if (!needLengths) return
    const missing = books.filter((b) => b.kind !== 'audio' && b.words === undefined)
    if (!missing.length) return
    let alive = true
    showToast(t('lib.countingWords'))
    ;(async () => {
      for (const b of missing) {
        if (!alive) return
        try {
          const f = await getFile(b.id)
          await setWords(b.id, f ? await wordsOfFile(f) : 0)
        } catch (e) {
          console.error(e)
          await setWords(b.id, 0)
        }
      }
      clearToast()
      await refresh()
    })()
    return () => {
      alive = false
    }
  }, [needLengths, books, showToast, clearToast, refresh])

  // books passing the filter and tag pickers, before the text query
  const scoped = useMemo(() => {
    const now = loadedAt
    const longest = filter.smart === 'longest' ? longestOf(books, lengths) : undefined
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
  }, [books, filter, activeTag, lengths, loadedAt])

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
    else if (sort === 'longest') list.sort(byLength(lengths))
    return list // 'recent' keeps the order listBooks returns
  }, [scoped, query, sort, lengths])

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
  const fo = useFolders({ books, shown, createdNames, searching, refresh, showToast, exitSelect, deleteBooks, confirm, sort, foldersFirst })
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
    editRun.current++
    setEditing(b)
    setEditName(splitBookName(b.title))
    setEditLookup({ busy: false })
    setEditError(undefined)
    setEditAuthor(b.author || '')
    setEditTags((b.tags ?? []).join(', '))
    setEditPhone(false)
    setEditSync(loadSettings().phoneRenameSync)
    if (deviceBooksSupported()) void phoneFileOf(b.id).then((p) => setEditPhone(!!p)).catch(() => {})
  }

  const downloadBook = async (b: BookMeta) => {
    try {
      const name = await saveBookToPhone(b.id)
      if (name) showToast(t(deviceBooksSupported() ? 'book.savedToPhone' : 'book.downloaded', { name }), undefined, 5000)
    } catch (e) {
      setError(t('book.saveFailed', { msg: e instanceof Error ? e.message : String(e) }))
    }
  }

  /** Google Books may be asked only after a yes; a no still identifies from the library's own names */
  const allowLookup = async () => {
    if (hasConsent('books')) return true
    const yes = await confirm({
      title: t('consent.title'),
      text: `${t('consent.books', { host: SERVICE_HOST.books })} ${t('consent.revoke')}`,
      ok: t('consent.allow'),
    })
    if (yes) setConsent('books', true)
    return yes
  }

  const identifyEditing = async () => {
    if (!editing) return
    const run = editRun.current
    const online = await allowLookup()
    if (run !== editRun.current) return
    setEditLookup({ busy: true })
    const opening = await openingLines(editing)
    if (run !== editRun.current) return
    const found = await identifyBook(
      { title: formatBookName(editName), author: editAuthor, fileName: editing.fileName },
      online,
      undefined,
      opening,
    ).catch(() => undefined)
    if (run !== editRun.current) return
    if (found) {
      setEditName({ series: found.series, number: found.number, title: found.title })
      setEditAuthor(found.author)
    }
    const note = found?.online
      ? 'edit.identifiedOnline'
      : found?.fromText
        ? online
          ? 'edit.identifiedTextLocal'
          : 'edit.identifiedTextOffline'
        : online
          ? 'edit.identifiedLocal'
          : 'edit.identifiedOffline'
    setEditLookup({ busy: false, note: t(note) })
  }

  const identifySelected = async () => {
    const list = books.filter((b) => selected.has(b.id))
    if (!list.length) return
    setIdentifying({ books: list, online: await allowLookup() })
  }

  const saveIdentified = async (changes: NameChange[]) => {
    setIdentifying(undefined)
    // each book is saved on its own, so one that fails does not stop the rest
    const saved: string[] = []
    let failure: unknown
    for (const c of changes) {
      try {
        await updateMeta(c.id, c.title, c.author)
        saved.push(c.id)
      } catch (e) {
        failure = e
      }
    }
    await refresh()
    exitSelect()
    const errors: string[] = []
    if (saved.length < changes.length) {
      const msg = failure instanceof Error ? failure.message : String(failure)
      errors.push(t('identify.saveFailed', { n: changes.length - saved.length, msg }))
    }
    if (saved.length) {
      showToast(t('identify.saved', { n: saved.length }), undefined, 4000)
      const { failed } = await autoSyncPhoneNames(saved).catch(() => ({ renamed: 0, failed: 1 }))
      if (failed) errors.push(t('edit.phoneFailed'))
    }
    if (errors.length) setError(errors.join('\n'))
  }

  const saveEdit = async () => {
    if (!editing) return
    const title = formatBookName(editName)
    if (!title) return
    setEditError(undefined)
    try {
      await updateMeta(editing.id, title, editAuthor.trim(), parseTags(editTags))
    } catch (e) {
      // the dialog stays open with what was typed, so saving can be tried again
      setEditError(t('edit.saveFailed', { msg: e instanceof Error ? e.message : String(e) }))
      return
    }
    const syncPhone = editPhone && editSync
    const id = editing.id
    editRun.current++
    setEditing(undefined)
    await refresh()
    if (syncPhone) {
      const { renamed, failed } = await syncPhoneNames([id]).catch(() => ({ renamed: 0, failed: 1 }))
      if (failed) setError(t('edit.phoneFailed'))
      else if (renamed) showToast(t('edit.phoneRenamed'), undefined, 4000)
    }
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
      <header className="lib-header" ref={header}>
        <button className="prefs-open quiet" aria-label={t('prefs.open')} title={t('prefs.open')} onClick={() => setSettingsOpen(true)}>
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
          busy={!!busy || imp.running}
          onBackup={backup.askExport}
          onRestore={() => restoreInput.current?.click()}
          onGoals={() => setGoalsOpen(true)}
          onReview={() => setReviewOpen(true)}
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

      {books.length > 1 && <LibSearch query={query} onQuery={setQuery} />}

      {books.length > 1 && (
        <LibTools
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
          list={list}
          onList={changeList}
          foldersFirst={foldersFirst}
          onFoldersFirst={changeFoldersFirst}
        />
      )}

      {selecting && (
        <div className="notice select-bar">
          {inFolderList ? (<>
            <span>{t('lib.foldersSelected', { n: selectedFolders.size })}</span>
            <button className="secondary" onClick={() => setSelectedFolders(new Set(folders.map((f) => f.key)))}>{t('lib.selectAllFolders')}</button>
            <button
              className="danger"
              disabled={pickedFolders.length === 0}
              onClick={() => fo.deleteFolders(pickedFolders)}
            >
              {t('lib.deleteFolders')}
            </button>
          </>) : (<>
            <span>{t('lib.booksSelected', { n: selected.size })}</span>
            <button className="secondary" onClick={() => setSelected(new Set((searching ? shown : current!.books).map((b) => b.id)))}>{t('lib.selectAllBooks')}</button>
            <button className="secondary" disabled={selected.size === 0} onClick={() => fo.setMoving(books.filter((b) => selected.has(b.id)))}>
              {t('lib.moveBooks')}
            </button>
            <button className="secondary" disabled={selected.size === 0} onClick={() => void identifySelected()}>
              {t('lib.identifyBooks')}
            </button>
            <button
              className="danger"
              disabled={selected.size === 0}
              onClick={() => setConfirmDel(books.filter((b) => selected.has(b.id)))}
            >
              {t('lib.deleteBooks')}
            </button>
          </>)}
          <button className="primary" onClick={exitSelect}>{t('common.done')}</button>
        </div>
      )}

      {(busy || imp.running) && (
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
                    : remainingText(Math.max(0, Math.ceil((batch.deadline - now) / 1000)))}
                </span>
              </div>
              <progress value={batch.done} max={batch.total} />
            </div>
          )}
          {busy ?? imp.message}
          {imp.running && !busy && imp.queue.length > 1 && (
            <ul className="import-queue">
              {imp.queue.map((it) => (
                <li key={it.id} className={it.active ? 'active' : undefined}>
                  <span>{it.name}</span>
                  <button
                    className="quiet"
                    aria-label={t('import.cancelOne', { name: it.name })}
                    title={t('import.cancelOne', { name: it.name })}
                    onClick={() => imp.cancelOne(it.id)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {imp.running && !busy && (
            <div className="import-actions">
              <small>{t('import.background')}</small>
              <button className="danger" onClick={imp.cancel}>
                {imp.queue.length > 1 ? t('import.cancelAll') : t('import.cancel')}
              </button>
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="notice error closable" role="alert">
          <span>{error}</span>
          <button className="notice-close" aria-label={t('common.close')} onClick={() => setError(undefined)}>✕</button>
        </div>
      )}

      {books.length === 0 && !busy && !imp.running ? (
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
            onDownload: downloadBook,
            onDelete: (b) => setConfirmDel([b]),
            refresh,
          }}
          list={list}
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
            list={list}
            selecting={selecting}
            selected={selected}
            onOpen={onOpen}
            onToggle={selection.toggleSelect}
            onEdit={openEdit}
            onMove={(b) => fo.setMoving([b])}
            onDownload={downloadBook}
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
      {settingsOpen && (
        <SettingsScreen
          startPage={settingsPage}
          onClose={() => {
            forgetSettings()
            setSettingsPage(undefined)
            setSettingsOpen(false)
            onSettingsClosed?.()
          }}
          onCheckUpdate={checkUpdate}
          onScanDevice={scanDevice}
          backup={{
            busy: !!busy || imp.running,
            storage,
            onPersist: reqPersist,
            onBackup: backup.askExport,
            onRestore: () => restoreInput.current?.click(),
            auto: { state: auto.state, last: auto.last, onEnable: auto.enable, onDisable: auto.disable, onRenew: auto.renew },
          }}
        />
      )}
      {goalsOpen && <GoalsDialog
          onClose={() => setGoalsOpen(false)}
          onSettings={() => {
            setGoalsOpen(false)
            setSettingsPage('goals')
            setSettingsOpen(true)
          }}
        />}
      {reviewOpen && <ReviewDialog books={books} onClose={() => setReviewOpen(false)} />}
      {editing && (
        <EditBookDialog
          name={editName}
          author={editAuthor}
          tags={editTags}
          knownTags={tags.map((x) => x.name)}
          phoneFile={editPhone ? { sync: editSync, onSync: setEditSync } : undefined}
          identify={{ ...editLookup, run: () => void identifyEditing() }}
          error={editError}
          onName={setEditName}
          onAuthor={setEditAuthor}
          onTags={setEditTags}
          onSave={saveEdit}
          onCancel={() => {
            editRun.current++
            setEditing(undefined)
          }}
        />
      )}
      {identifying && (
        <IdentifyDialog
          books={identifying.books}
          online={identifying.online}
          onSave={(c) => void saveIdentified(c)}
          onCancel={() => setIdentifying(undefined)}
        />
      )}
      {/* last, so a question asked from inside another dialog shows on top of it */}
      {confirmAsk && <ConfirmDialog ask={confirmAsk} />}
    </div>
  )
}
