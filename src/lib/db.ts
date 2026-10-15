import { createStore, get, set, del, values } from 'idb-keyval'

export interface BookRecord {
  id: string
  title: string
  author: string
  kind: 'epub' | 'pdf' | 'other'
  file: Blob
  fileName: string
  cover?: Blob
  /** PDF only: extracted reflowable HTML sections */
  pdf?: { rtl: boolean; pageCount: number; sections: string[] }
  addedAt: number
  lastOpened?: number
  cfi?: string
  fraction?: number
}

const store = createStore('reader-db', 'books')

export const saveBook = (b: BookRecord) => set(b.id, b, store)
export const getBook = (id: string) => get<BookRecord>(id, store)
export const deleteBook = (id: string) => del(id, store)
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
