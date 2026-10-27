import { beforeEach, describe, expect, it } from 'vitest'
import { createStore, set } from 'idb-keyval'
import { deleteBook, getAllProgress, getBook, listBooks, migrate, SCHEMA_VERSION } from './db'
import { explainImportError, ImportError } from './errors'

const books = createStore('reader-db', 'books')

beforeEach(async () => {
  for (const b of await listBooks()) await deleteBook(b.id)
  for (const id of Object.keys(await getAllProgress())) await deleteBook(id)
  localStorage.clear()
})

describe('migrate', () => {
  const legacy = { id: 'old', title: 'T', author: '', kind: 'epub', file: new Blob(['x']), fileName: 'o.epub', addedAt: 5, cfi: 'c', fraction: 0.3, lastOpened: 9 }

  it('moves a position stored inside the book record into the progress store', async () => {
    await set('old', legacy, books)
    await migrate()
    expect(await getAllProgress()).toEqual({ old: { cfi: 'c', fraction: 0.3, lastOpened: 9 } })
    expect(await getBook('old')).toMatchObject({ cfi: 'c', fraction: 0.3, lastOpened: 9 })
    expect(localStorage.getItem('reader:schemaVersion')).toBe(String(SCHEMA_VERSION))
  })
  it('is safe to run twice', async () => {
    await set('old', legacy, books)
    await migrate()
    localStorage.clear()
    await migrate()
    expect((await getBook('old'))!.cfi).toBe('c')
  })
  it('keeps a newer position that already exists', async () => {
    await set('old', legacy, books)
    await set('old', { cfi: 'newer', fraction: 0.9, lastOpened: 99 }, createStore('reader-progress-db', 'progress'))
    await migrate()
    expect((await getBook('old'))!.cfi).toBe('newer')
  })
  it('gives a book already read the day it was last opened as its finish date, and leaves the rest alone', async () => {
    const progress = createStore('reader-progress-db', 'progress')
    const base = { author: '', kind: 'epub', fileName: 'x.epub', addedAt: 5 }
    await set('read', { ...base, id: 'read', title: 'R' }, books)
    await set('read', { cfi: 'c', fraction: 1, lastOpened: 77 }, progress)
    await set('half', { ...base, id: 'half', title: 'H' }, books)
    await set('half', { cfi: 'c', fraction: 0.5, lastOpened: 88 }, progress)
    await set('mark', { ...base, id: 'mark', title: 'M', finished: true, finishedAt: 3 }, books)
    await migrate()
    const byId = new Map((await listBooks()).map((b) => [b.id, b]))
    expect(byId.get('read')!.finishedAt).toBe(77)
    expect(byId.get('half')!.finishedAt).toBeUndefined()
    expect(byId.get('mark')!.finishedAt).toBe(3)
  })
})

describe('explainImportError', () => {
  it('passes user-facing errors through and hides internals', () => {
    expect(explainImportError(new ImportError('הקובץ ריק.'))).toBe('הקובץ ריק.')
    expect(explainImportError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toMatch(/פגום/)
    expect(explainImportError(Object.assign(new Error('x'), { name: 'PasswordException' }))).toMatch(/סיסמה/)
    expect(explainImportError(new DOMException('full', 'QuotaExceededError'))).toMatch(/מקום/)
  })
})
