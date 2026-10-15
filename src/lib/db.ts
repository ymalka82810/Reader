import { createStore, get, set, del, values, entries } from 'idb-keyval'

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

const withProgress = (b: BookRecord, p?: Progress): BookRecord =>
  p ? { ...b, cfi: p.cfi, fraction: p.fraction, lastOpened: p.lastOpened } : b

export const saveBook = (b: BookRecord) => set(b.id, b, store)
export const getBook = async (id: string) => {
  const b = await get<BookRecord>(id, store)
  return b && withProgress(b, await get<Progress>(id, progressStore))
}
export const deleteBook = async (id: string) => {
  await del(id, store)
  await del(id, notesStore)
  await del(id, progressStore)
}
export const listBooks = async () => {
  const progress = new Map(await entries<string, Progress>(progressStore))
  return (await values<BookRecord>(store))
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

export async function updateMeta(id: string, title: string, author: string) {
  const b = await get<BookRecord>(id, store)
  if (!b) return
  b.title = title
  b.author = author
  await saveBook(b)
}

export const newId = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)

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
