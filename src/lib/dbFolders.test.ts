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

const folders = async () => Object.fromEntries((await listBooks()).map((b) => [b.id, b.folder]))

describe('folders and authors', () => {
  it('a book moved into a folder keeps its author', async () => {
    await saveBook(book('k1', 'כותב א'))
    await setFolder(['k1'], 'לקרוא בקיץ')
    expect((await authors()).k1).toBe('כותב א')
    expect((await folders()).k1).toBe('לקרוא בקיץ')
  })

  it('a book moved with setAuthor takes the folder name as its author', async () => {
    await saveBook(book('m1', 'כותב א'))
    await saveBook(book('m2', ''))
    await setFolder(['m1', 'm2'], 'כותב ב', true)
    expect(await authors()).toMatchObject({ m1: 'כותב ב', m2: 'כותב ב' })
  })

  it('renaming a folder moves its books but keeps their authors', async () => {
    await saveBook(book('s1', 'ישן א'))
    await saveBook(book('s2', 'מחבר'))
    await setFolder(['s2'], 'ישן א')
    await renameFolder('ישן א', 'חדש א')
    expect(await authors()).toMatchObject({ s1: 'ישן א', s2: 'מחבר' })
    expect(await folders()).toMatchObject({ s1: 'חדש א', s2: 'חדש א' })
  })

  it('renaming a folder with setAuthor changes the author of every book in it', async () => {
    await saveBook(book('r1', 'ישן'))
    await saveBook(book('r2', 'ישן'))
    await saveBook(book('r3', 'אחר'))
    await renameFolder('ישן', 'חדש', true)
    expect(await authors()).toMatchObject({ r1: 'חדש', r2: 'חדש', r3: 'אחר' })
  })

  it('moving to "no folder" keeps the author', async () => {
    await saveBook(book('n1', 'מחבר'))
    await setFolder(['n1'], undefined)
    expect((await authors()).n1).toBe('מחבר')
  })
})
