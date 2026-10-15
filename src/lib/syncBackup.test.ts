import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteBook,
  getAllProgress,
  getBook,
  getNotes,
  listBooks,
  mergeProgress,
  saveBook,
  saveNotes,
  updateProgress,
  type Annotation,
  type BookRecord,
} from './db'
import { exportLibrary, importLibrary } from './backup'
import { exportSync, importSync } from './sync'
import { addStats, loadStats } from './stats'

const book = (id: string, extra: Partial<BookRecord> = {}): BookRecord => ({
  id,
  title: `Book ${id}`,
  author: 'A',
  kind: 'epub',
  file: new Blob([`content-${id}`], { type: 'application/epub+zip' }),
  fileName: `${id}.epub`,
  addedAt: 1000,
  ...extra,
})
const note = (id: string, text = 't'): Annotation => ({
  id,
  kind: 'highlight',
  cfi: 'epubcfi(/6/2)',
  text,
  color: 'yellow',
  createdAt: 1,
})
const asFile = (b: Blob) => new File([b], 'x.bin')

async function wipe() {
  for (const b of await listBooks()) await deleteBook(b.id)
  for (const id of Object.keys(await getAllProgress())) await deleteBook(id)
  localStorage.clear()
}

beforeEach(wipe)

describe('mergeProgress', () => {
  it('keeps the most recently read position', async () => {
    await saveBook(book('a'))
    expect(await mergeProgress('a', { cfi: 'x', fraction: 0.1, lastOpened: 100 })).toBe(true)
    expect(await mergeProgress('a', { cfi: 'old', fraction: 0.9, lastOpened: 50 })).toBe(false)
    expect(await mergeProgress('a', { cfi: 'y', fraction: 0.5, lastOpened: 200 })).toBe(true)
    expect((await getBook('a'))!.cfi).toBe('y')
  })
  it('ignores an empty cfi', async () => {
    expect(await mergeProgress('a', { cfi: '', fraction: 0, lastOpened: 1 })).toBe(false)
  })
})

describe('backup', () => {
  it('round-trips books, covers, progress, notes and stats', async () => {
    await saveBook(book('a', { cover: new Blob(['cover'], { type: 'image/png' }) }))
    await saveBook(book('b'))
    await updateProgress('a', 'cfi-a', 0.4)
    await saveNotes('a', [note('n1', 'hello')])
    addStats('a', 300, 0.1)

    const blob = await exportLibrary()
    await wipe()
    expect(await listBooks()).toHaveLength(0)

    expect(await importLibrary(asFile(blob))).toBe(2)
    const a = (await getBook('a'))!
    expect(await a.file.text()).toBe('content-a')
    expect(a.file.type).toBe('application/epub+zip')
    expect(await a.cover!.text()).toBe('cover')
    expect(a.cfi).toBe('cfi-a')
    expect((await getBook('b'))!.cover).toBeUndefined()
    expect((await getNotes('a'))[0].text).toBe('hello')
    expect(loadStats('a')).toEqual({ secs: 300, frac: 0.1 })
  })
  it('does not rewind a book when restoring an older backup', async () => {
    await saveBook(book('a'))
    await updateProgress('a', 'old', 0.1)
    const blob = await exportLibrary()
    await new Promise((r) => setTimeout(r, 5))
    await updateProgress('a', 'newer', 0.8)
    await importLibrary(asFile(blob))
    expect((await getBook('a'))!.cfi).toBe('newer')
  })
  it('merges notes by id instead of replacing', async () => {
    await saveBook(book('a'))
    await saveNotes('a', [note('n1')])
    const blob = await exportLibrary()
    await saveNotes('a', [note('n1'), note('n2')])
    await importLibrary(asFile(blob))
    expect((await getNotes('a')).map((n) => n.id).sort()).toEqual(['n1', 'n2'])
  })
  it('rejects an unsupported version', async () => {
    const header = new TextEncoder().encode(JSON.stringify({ version: 2, books: [] }))
    const len = new Uint8Array(4)
    new DataView(len.buffer).setUint32(0, header.length, true)
    await expect(importLibrary(asFile(new Blob([len, header])))).rejects.toThrow()
  })
})

describe('sync', () => {
  it('moves newer positions and new notes, skips unknown books', async () => {
    await saveBook(book('a'))
    await saveBook(book('b'))
    await updateProgress('a', 'remote', 0.7)
    await updateProgress('b', 'other', 0.2)
    await saveNotes('a', [note('n1'), note('n2')])
    const data = JSON.parse(await (await exportSync()).text())
    data.books['a'].progress.lastOpened += 10_000 // the other device read it more recently

    await deleteBook('b') // the file mentions a book this device doesn't have
    await updateProgress('a', 'local', 0.1)
    await saveNotes('a', [note('n1')])

    const res = await importSync(new File([JSON.stringify(data)], 's.json'))
    expect(res).toEqual({ moved: 1, notes: 1, skipped: 1 })
    expect((await getBook('a'))!.cfi).toBe('remote')
    expect(await getNotes('a')).toHaveLength(2)
  })
  it('leaves books with no data out of the export', async () => {
    await saveBook(book('a'))
    expect(JSON.parse(await (await exportSync()).text()).books).toEqual({})
  })
  it('rejects files that are not sync files', async () => {
    await expect(importSync(new File(['{"kind":"x","version":1,"books":{}}'], 's.json'))).rejects.toThrow()
  })
})
