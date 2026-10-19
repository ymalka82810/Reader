import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { listBooks, renameFolder, saveBook, setFolder, type BookRecord } from './db'

const book = (id: string, author: string): BookRecord => ({
  id,
  title: `ספר ${id}`,
  author,
  kind: 'epub',
  file: new Blob(['x']),
  fileName: `${id}.epub`,
  addedAt: 1,
})

const authors = async () => Object.fromEntries((await listBooks()).map((b) => [b.id, b.author]))

describe('folder = author', () => {
  it('a book moved into a folder takes the folder name as its author', async () => {
    await saveBook(book('m1', 'כותב א'))
    await saveBook(book('m2', ''))
    await setFolder(['m1', 'm2'], 'כותב ב')
    expect(await authors()).toMatchObject({ m1: 'כותב ב', m2: 'כותב ב' })
  })

  it('renaming a folder changes the author of every book in it', async () => {
    await saveBook(book('r1', 'ישן'))
    await saveBook(book('r2', 'ישן'))
    await saveBook(book('r3', 'אחר'))
    await renameFolder('ישן', 'חדש')
    expect(await authors()).toMatchObject({ r1: 'חדש', r2: 'חדש', r3: 'אחר' })
  })

  it('moving to "no folder" keeps the author', async () => {
    await saveBook(book('n1', 'מחבר'))
    await setFolder(['n1'], undefined)
    expect((await authors()).n1).toBe('מחבר')
  })
})
