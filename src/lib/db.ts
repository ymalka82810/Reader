import { createStore, get, set, del, values } from 'idb-keyval'

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

export const saveBook = (b: BookRecord) => set(b.id, b, store)
export const getBook = (id: string) => get<BookRecord>(id, store)
export const deleteBook = async (id: string) => {
  await del(id, store)
  await del(id, notesStore)
}
export const listBooks = async () =>
  (await values<BookRecord>(store)).sort(
    (a, b) => (b.lastOpened ?? b.addedAt) - (a.lastOpened ?? a.addedAt),
  )

export async function updateProgress(id: string, cfi: string, fraction: number) {
  const b = await getBook(id)
  if (!b) return
  b.cfi = cfi
  b.fraction = fraction
  b.lastOpened = Date.now()
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
