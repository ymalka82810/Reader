import { createStore, get, set, del, values, entries } from 'idb-keyval'
import { deleteStats, loadStats, mergeStats } from './stats'

export interface BookRecord {
  id: string
  title: string
  author: string
  kind: 'epub' | 'pdf' | 'other'
  file: Blob
  fileName: string
  cover?: Blob
  /** true when `file` is an EPUB that was converted from a PDF */
  fromPdf?: boolean
  /** legacy (imported before PDF→EPUB conversion): extracted reflowable HTML sections */
  pdf?: { rtl: boolean; pageCount: number; sections: string[] }
  addedAt: number
  /** manual "read" mark, see isFinished */
  finished?: boolean
  lastOpened?: number
  cfi?: string
  fraction?: number
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
  writeQueue = run.catch(() => {})
  return run
}

export const saveBook = (b: BookRecord) =>
  serial(async () => {
    const { file, ...meta } = b
    await set(b.id, file, fileStore)
    await set(b.id, meta, store)
  })

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
export const listBooks = async () => {
  const progress = new Map(await entries<string, Progress>(progressStore))
  return (await values<BookMeta>(store))
    .map((b) => withProgress(b, progress.get(b.id)))
    .sort((a, b) => (b.lastOpened ?? b.addedAt) - (a.lastOpened ?? a.addedAt))
}

export const updateProgress = (id: string, cfi: string, fraction: number) =>
  set(id, { cfi, fraction, lastOpened: Date.now() } satisfies Progress, progressStore)

export const getAllProgress = async () => Object.fromEntries(await entries<string, Progress>(progressStore))

/** keeps whichever position was read most recently; returns true if `incoming` won */
export async function mergeProgress(id: string, incoming: Progress): Promise<boolean> {
  if (!incoming.cfi) return false
  const cur = await get<Progress>(id, progressStore)
  if (cur && cur.lastOpened >= incoming.lastOpened) return false
  await set(id, incoming, progressStore)
  return true
}

export const updateMeta = (id: string, title: string, author: string) =>
  serial(async () => {
    const b = await get<BookMeta>(id, store)
    if (!b) return
    b.title = title
    b.author = author
    await set(id, b, store)
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
