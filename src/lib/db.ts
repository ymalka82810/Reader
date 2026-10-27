import { createStore, get, set, del, values, entries } from 'idb-keyval'
import { deleteStats, loadStats, mergeStats } from './stats'
import { folderKey } from './folders'
import { decodeEntities } from './entities'
import { realAuthor } from './authorName'
import type { AudioInfo } from './audioBook'

export interface BookRecord {
  id: string
  title: string
  author: string
  kind: 'epub' | 'pdf' | 'audio' | 'other'
  file: Blob
  fileName: string
  cover?: Blob
  /** true when `file` is an EPUB that was converted from a PDF */
  fromPdf?: boolean
  /** which PDF→EPUB conversion made `file` (PDF_CONVERSION in lib/importBook); unset = an older one */
  conv?: number
  /** audiobooks: length and chapters; `cfi` and bookmarks then hold times (see lib/audioBook) */
  audio?: AudioInfo
  /** legacy (imported before PDF→EPUB conversion): extracted reflowable HTML sections */
  pdf?: { rtl: boolean; pageCount: number; sections: string[] }
  addedAt: number
  /** manual "read" mark, see isFinished */
  finished?: boolean
  lastOpened?: number
  /** when the user removed the book from the "continue reading" carousel; it comes back once the book is opened again */
  resumeHiddenAt?: number
  cfi?: string
  fraction?: number
  /** folder picked by the user; unset = filed by author, '' = deliberately in no folder */
  folder?: string
  /** words in the text, counted when the book is added; unset = not counted yet (books from before) */
  words?: number
  /** labels the user attached; a book can carry several */
  tags?: string[]
  /** an EPUB that declares scripts (opens in the sandboxed reader), checked when the book is added; unset = books from before */
  scripted?: boolean
}

const store = createStore('reader-db', 'books')

/** reading position — kept in its own tiny store so saving it never rewrites the book's Blob */
export interface Progress {
  cfi: string
  fraction: number
  lastOpened: number
}

const progressStore = createStore('reader-progress-db', 'progress')

const withProgress = <T extends BookMeta>(b: T, p?: Progress): T =>
  p ? { ...b, cfi: p.cfi, fraction: p.fraction, lastOpened: p.lastOpened } : b

/** a book without its file: what the library list needs, cheap to read for every book */
export type BookMeta = Omit<BookRecord, 'file'>

/** book files live in their own store so listing the library never touches the Blobs */
const fileStore = createStore('reader-files-db', 'files')

export const getFile = (id: string) => get<Blob>(id, fileStore)

/** Writes that read-modify-write a book's metadata (or replace it) run one at a time, so overlapping calls
 *  — e.g. a backup import while the user edits a title — can't overwrite each other's changes. */
let writeQueue: Promise<unknown> = Promise.resolve()
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = writeQueue.then(fn, fn)
  // the caller still gets `run` and its rejection; only the queue's own tail swallows it, so one failed write doesn't block the next
  writeQueue = run.catch(() => {})
  return run
}

export const saveBook = (b: BookRecord) =>
  serial(async () => {
    const { file, ...meta } = b
    await set(b.id, file, fileStore)
    await set(b.id, meta, store)
  })

/**
 * The same source file converted again by a newer converter: the new file replaces the old one under the same id.
 * Positions inside the old file don't carry over to the new one, so the reading position keeps only how far in the reader was.
 */
export async function saveReconverted(rec: BookRecord) {
  await saveBook(rec)
  const p = await get<Progress>(rec.id, progressStore)
  if (p?.cfi) await set(rec.id, { ...p, cfi: '' } satisfies Progress, progressStore)
}

/** a book's metadata only (no Blob) */
export const getBookMeta = (id: string) => get<BookMeta>(id, store)

/** cheap existence check: reads only the small metadata record, never the book's Blob */
export const hasBook = async (id: string) => (await get<BookMeta>(id, store)) !== undefined
export const getBook = async (id: string): Promise<BookRecord | undefined> => {
  const [meta, file] = await Promise.all([get<BookMeta>(id, store), getFile(id)])
  if (!meta || !file) return undefined
  return withProgress({ ...meta, file }, await get<Progress>(id, progressStore))
}
export const deleteBook = (id: string) =>
  serial(async () => {
    await del(id, store)
    await del(id, fileStore)
    await del(id, notesStore)
    await del(id, progressStore)
    await deleteStats(id)
  })

/** Saves `rec` first and only then removes the book it replaces, so a failed save loses nothing.
 *  Stats, the "read" mark and — when both are the same kind of file, so positions still make sense —
 *  notes and reading position move over to the new id. */
export async function replaceBook(oldId: string, rec: BookRecord) {
  const old = await get<BookMeta>(oldId, store)
  await saveBook(rec)
  if (!old || oldId === rec.id) return
  const [notes, progress, stats] = await Promise.all([
    getNotes(oldId),
    get<Progress>(oldId, progressStore),
    loadStats(oldId),
  ])
  if (!!old.fromPdf === !!rec.fromPdf) {
    if (notes.length) await saveNotes(rec.id, notes)
    if (progress) await mergeProgress(rec.id, progress)
  }
  if (stats.secs > 0) await mergeStats(rec.id, stats)
  if (old.finished !== undefined) await setFinished(rec.id, old.finished)
  await deleteBook(oldId)
}
/** Ids of files merged into another book (lib/bookCopies), so adding the same file again finds the book it went into. */
const mergedStore = createStore('reader-merged-db', 'merged')
export const mergedInto = (id: string) => get<string>(id, mergedStore)

/**
 * One book in the library twice: `dropId`'s copy goes and `keepId`'s stays, with the other's reading time, "read"
 * mark, tags and folder (when it has none), and — when both are the same kind of file, so positions still make sense
 * — its notes and reading position. A name the user approved on the dropped copy only is passed as `name`.
 */
export async function mergeBooks(keepId: string, dropId: string, name?: { title: string; author: string }) {
  const [keep, drop] = await Promise.all([get<BookMeta>(keepId, store), get<BookMeta>(dropId, store)])
  if (!keep || !drop || keepId === dropId) return
  const [notes, dropNotes, progress, stats] = await Promise.all([getNotes(keepId), getNotes(dropId), get<Progress>(dropId, progressStore), loadStats(dropId)])
  if (keep.kind === drop.kind && !!keep.fromPdf === !!drop.fromPdf) {
    const seen = new Set(notes.map((n) => `${n.kind}|${n.cfi}`))
    const more = dropNotes.filter((n) => !seen.has(`${n.kind}|${n.cfi}`))
    if (more.length) await saveNotes(keepId, [...notes, ...more])
    if (progress) await mergeProgress(keepId, progress)
  }
  if (stats.secs > 0) await mergeStats(keepId, stats)
  await serial(async () => {
    const b = await get<BookMeta>(keepId, store)
    if (!b) return
    const tags = [...new Set([...(b.tags ?? []), ...(drop.tags ?? [])])]
    await set(
      keepId,
      {
        ...b,
        ...(name && { title: name.title, author: name.author }),
        ...(tags.length && { tags }),
        ...(b.folder === undefined && drop.folder !== undefined && { folder: drop.folder }),
        ...((b.finished || drop.finished) && { finished: true }),
      },
      store,
    )
  })
  await set(dropId, keepId, mergedStore)
  await deleteBook(dropId)
}

export const listBooks = async () => {
  const progress = new Map(await entries<string, Progress>(progressStore))
  return (await values<BookMeta>(store))
    .map((b) => withProgress(b, progress.get(b.id)))
    .sort((a, b) => (b.lastOpened ?? b.addedAt) - (a.lastOpened ?? a.addedAt))
}

export const updateProgress = (id: string, cfi: string, fraction: number) =>
  set(id, { cfi, fraction, lastOpened: Date.now() } satisfies Progress, progressStore)

export const getProgress = (id: string) => get<Progress>(id, progressStore)
export const getAllProgress = async () => Object.fromEntries(await entries<string, Progress>(progressStore))

/** keeps whichever position was read most recently; returns true if `incoming` won */
export async function mergeProgress(id: string, incoming: Progress): Promise<boolean> {
  if (!incoming.cfi) return false
  const cur = await get<Progress>(id, progressStore)
  if (cur && cur.lastOpened >= incoming.lastOpened) return false
  await set(id, incoming, progressStore)
  return true
}

export const updateMeta = (id: string, title: string, author: string, tags?: string[]) =>
  serial(async () => {
    const b = await get<BookMeta>(id, store)
    if (!b) return
    b.title = title
    b.author = author
    // left alone when not given; an empty list removes them
    if (tags?.length) b.tags = tags
    else if (tags) delete b.tags
    await set(id, b, store)
  })

/** stores the word count of a book */
export const setWords = (id: string, words: number) =>
  serial(async () => {
    const b = await get<BookMeta>(id, store)
    if (b) await set(id, { ...b, words }, store)
  })

/** stores whether a book declares scripts, for books added before that was checked on import */
export const setScripted = (id: string, scripted: boolean) =>
  serial(async () => {
    const b = await get<BookMeta>(id, store)
    if (b) await set(id, { ...b, scripted }, store)
  })

/** moves books to a folder; `undefined` puts them back under their author. The author is kept unless `setAuthor`
 *  asks for a named folder to become it. */
export const setFolder = (ids: string[], folder: string | undefined, setAuthor = false) =>
  serial(async () => {
    for (const id of ids) {
      const b = await get<BookMeta>(id, store)
      if (!b) continue
      if (folder === undefined) delete b.folder
      else {
        b.folder = folder
        if (setAuthor && folder.trim()) b.author = folder
      }
      await set(id, b, store)
    }
  })

/** folders the user created, kept even while empty (books alone only keep a folder alive while they are in it) */
const folderStore = createStore('reader-folders-db', 'folders')
const FOLDERS_KEY = 'names'
const sameName = (a: string, b: string) => folderKey({ author: a }) === folderKey({ author: b })

export const listFolderNames = async () => (await get<string[]>(FOLDERS_KEY, folderStore)) ?? []

export const addFolderName = (name: string) =>
  serial(async () => {
    const names = await listFolderNames()
    if (!names.some((n) => sameName(n, name))) await set(FOLDERS_KEY, [...names, name], folderStore)
  })

/** removes a folder from the list of created ones; its books (if any) stay where they are */
export const removeFolderName = (name: string) =>
  serial(async () => {
    await set(FOLDERS_KEY, (await listFolderNames()).filter((n) => !sameName(n, name)), folderStore)
  })

/** renames a folder: every book in it (also those filed there only by author) moves to the new name, keeping its author
 *  unless `setAuthor` asks for the new name to become it */
export const renameFolder = (oldName: string, newName: string, setAuthor = false) =>
  serial(async () => {
    for (const b of await values<BookMeta>(store)) {
      if (folderKey(b) !== folderKey({ author: oldName })) continue
      await set(b.id, setAuthor ? { ...b, folder: newName, author: newName } : { ...b, folder: newName }, store)
    }
    const names = (await listFolderNames()).filter((n) => !sameName(n, oldName) && !sameName(n, newName))
    await set(FOLDERS_KEY, [...names, newName], folderStore)
  })

/** explicit "read" mark; when unset a book counts as read once its position passes 98% */
export const isFinished = (b: BookMeta) => b.finished ?? (b.fraction ?? 0) >= 0.98

export const setFinished = (id: string, finished: boolean) =>
  serial(async () => {
    const b = await get<BookMeta>(id, store)
    if (!b) return
    b.finished = finished
    await set(id, b, store)
  })

export const hideFromResume = (id: string) =>
  serial(async () => {
    const b = await get<BookMeta>(id, store)
    if (!b) return
    b.resumeHiddenAt = Date.now()
    await set(id, b, store)
  })

export const newId = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)

const SAMPLE = 256 * 1024

/** Stable id from the file's size plus SHA-256 of its first, middle and last 256 KB, so the same book gets the
 *  same id on every device without reading a whole (possibly hundreds of MB) file into memory.
 *  Random when crypto.subtle is unavailable. */
export async function contentId(file: Blob): Promise<string> {
  if (!crypto.subtle) return newId()
  const mid = Math.max(0, Math.floor((file.size - SAMPLE) / 2))
  const sample = new Blob([
    new TextEncoder().encode(`${file.size}:`),
    file.slice(0, SAMPLE),
    file.slice(mid, mid + SAMPLE),
    file.slice(Math.max(0, file.size - SAMPLE)),
  ])
  const digest = await crypto.subtle.digest('SHA-256', await sample.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** highlights, notes and bookmarks — kept in their own store so saving them never races with reading progress */
export interface Annotation {
  id: string
  kind: 'highlight' | 'bookmark'
  /** CFI of the highlighted range, or of the bookmarked location */
  cfi: string
  /** highlighted text, or a short label for a bookmark */
  text: string
  color: string
  note?: string
  createdAt: number
}

const notesStore = createStore('reader-notes-db', 'notes')

export const getNotes = async (bookId: string) => (await get<Annotation[]>(bookId, notesStore)) ?? []
export const saveNotes = (bookId: string, notes: Annotation[]) =>
  notes.length ? set(bookId, notes, notesStore) : del(bookId, notesStore)

/** every book's highlights and notes, for searching the whole library at once */
export const getAllNotes = async () => new Map(await entries<string, Annotation[]>(notesStore))

/* ---- schema migrations ----
 * idb-keyval opens each database at IndexedDB version 1 and never upgrades it, so the stores themselves are
 * fixed. What changes over time is the shape of the records inside them; each step below rewrites old records
 * into the current shape. Rules for adding one:
 *   - append to `migrations` (never edit or reorder a released step) — the schema version is the array length
 *   - make it idempotent: the stored version can be lost (private mode, cleared site data), which re-runs everything
 *   - keep BookRecord/Annotation readable for old data until the migration has shipped
 */
const migrations: (() => Promise<void>)[] = [
  // 1: reading position used to live inside the book record, which rewrote the whole Blob on every page turn
  async () => {
    for (const [id, b] of await entries<string, BookRecord>(store)) {
      if (!b.cfi) continue
      if (!(await get<Progress>(id, progressStore)))
        await set(id, { cfi: b.cfi, fraction: b.fraction ?? 0, lastOpened: b.lastOpened ?? b.addedAt } satisfies Progress, progressStore)
      const { cfi: _cfi, fraction: _fraction, lastOpened: _lastOpened, ...rest } = b
      await set(id, rest, store)
    }
  },
  // 2: the file Blob used to live inside the book record, so listing the library read every book
  async () => {
    for (const [id, b] of await entries<string, Partial<BookRecord>>(store)) {
      if (!b.file) continue
      const { file, ...meta } = b
      await set(id, file, fileStore)
      await set(id, meta, store)
    }
  },
  // 3: names read from a file's metadata kept their HTML entities ("ג&apos;יימס"), and a program or user name stood as the
  // author ("Aspose", "CamScanner", "Unknown Author"): decoded, and the author emptied when it is no author
  async () => {
    for (const [id, b] of await entries<string, BookMeta>(store)) {
      const next = { ...b, title: decodeEntities(b.title ?? ''), author: realAuthor(b.author) }
      if (b.folder !== undefined) next.folder = decodeEntities(b.folder)
      if (next.title !== b.title || next.author !== b.author || next.folder !== b.folder) await set(id, next, store)
    }
  },
]

export const SCHEMA_VERSION = migrations.length
const VERSION_KEY = 'reader:schemaVersion'

const storedVersion = () => {
  try {
    return Number(localStorage.getItem(VERSION_KEY)) || 0
  } catch {
    return 0
  }
}

/** brings stored data up to SCHEMA_VERSION; call once at startup, before anything reads the library */
export async function migrate(): Promise<void> {
  for (let v = storedVersion(); v < migrations.length; v++) {
    await migrations[v]!()
    try {
      localStorage.setItem(VERSION_KEY, String(v + 1))
    } catch {
      /* the steps are idempotent, so losing the version only costs a re-run */
    }
  }
}
