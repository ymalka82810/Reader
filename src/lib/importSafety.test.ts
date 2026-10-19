import { beforeEach, describe, expect, it } from 'vitest'
import {
  contentId,
  deleteBook,
  getBook,
  getNotes,
  hasBook,
  listBooks,
  replaceBook,
  saveBook,
  saveNotes,
  setFinished,
  updateMeta,
  type BookRecord,
} from './db'
import { exportLibrary } from './backupExport'
import { importLibrary } from './backupImport'
import { parseManifest } from './backupManifest'
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

beforeEach(async () => {
  for (const b of await listBooks()) await deleteBook(b.id)
})

describe('replaceBook', () => {
  it('moves notes, stats and the read mark to the new id and removes the old book', async () => {
    await saveBook(book('old'))
    await saveNotes('old', [{ id: 'n', kind: 'highlight', cfi: 'c', text: 't', color: 'y', createdAt: 1 }])
    await addStats('old', 300, 0.1)
    await setFinished('old', true)

    await replaceBook('old', book('new'))

    expect(await hasBook('old')).toBe(false)
    expect((await getBook('new'))!.finished).toBe(true)
    expect(await getNotes('new')).toHaveLength(1)
    expect((await loadStats('new')).secs).toBe(300)
  })

  it('leaves the old book alone when saving the new one fails', async () => {
    await saveBook(book('old'))
    const bad = { ...book('new'), id: undefined as unknown as string } // IndexedDB rejects a missing key
    await expect(replaceBook('old', bad)).rejects.toBeDefined()
    expect(await hasBook('old')).toBe(true)
  })
})

describe('write queue', () => {
  it('does not lose a metadata edit made while a book is being saved', async () => {
    await saveBook(book('a'))
    await Promise.all([updateMeta('a', 'New title', 'B'), setFinished('a', true)])
    const b = (await getBook('a'))!
    expect([b.title, b.author, b.finished]).toEqual(['New title', 'B', true])
  })
})

describe('contentId', () => {
  it('is stable, and differs for files that differ in size or content', async () => {
    const a = new Blob(['x'.repeat(1000)])
    expect(await contentId(a)).toBe(await contentId(new Blob(['x'.repeat(1000)])))
    expect(await contentId(a)).not.toBe(await contentId(new Blob(['x'.repeat(1001)])))
    expect(await contentId(a)).not.toBe(await contentId(new Blob(['y'.repeat(1000)])))
  })
  it('notices a change at the end of a file larger than the sampled parts', async () => {
    const big = (tail: string) => new Blob([new Uint8Array(2 * 1024 * 1024), tail])
    expect(await contentId(big('a'))).not.toBe(await contentId(big('b')))
  })
})

describe('parseManifest', () => {
  const ok = { version: 1, books: [{ id: 'a', title: 't', author: 'x', fileRange: [0, 5] }] }

  it('accepts a well-formed manifest', () => {
    expect(parseManifest(JSON.stringify(ok), 10).books[0]!.fileRange).toEqual([0, 5])
  })
  it('rejects garbage, wrong shapes and out-of-bounds ranges', () => {
    expect(() => parseManifest('not json', 10)).toThrow()
    expect(() => parseManifest('null', 10)).toThrow()
    expect(() => parseManifest(JSON.stringify({ version: 1, books: {} }), 10)).toThrow()
    expect(() => parseManifest(JSON.stringify({ ...ok, books: [{ id: 'a', title: 't' }] }), 10)).toThrow()
    expect(() => parseManifest(JSON.stringify(ok), 4)).toThrow()
    const bad = (r: unknown) => JSON.stringify({ version: 1, books: [{ id: 'a', title: 't', fileRange: r }] })
    expect(() => parseManifest(bad([5, 2]), 10)).toThrow()
    expect(() => parseManifest(bad([-1, 2]), 10)).toThrow()
    expect(() => parseManifest(bad([0.5, 2]), 10)).toThrow()
    expect(() => parseManifest(bad('0-2'), 10)).toThrow()
  })
  it('keeps a font and folders, dropping a font that could break out of the CSS url()', () => {
    const font = { name: 'f', dataUrl: 'data:font/ttf;base64,AAEA' }
    const m = parseManifest(JSON.stringify({ ...ok, customFont: font, folders: ['a', 3, ' ', 'b'] }), 10)
    expect(m.customFont).toEqual(font)
    expect(m.folders).toEqual(['a', 'b'])
    const evil = { name: 'f', dataUrl: 'data:font/ttf;base64,AA"); } body { color: red' }
    expect(parseManifest(JSON.stringify({ ...ok, customFont: evil }), 10).customFont).toBeUndefined()
  })
})

describe('importLibrary from an encrypted backup', () => {
  it('restores books while decrypting piece by piece', async () => {
    const big = new Blob([new Uint8Array(2.5 * 1024 * 1024).fill(7)])
    await saveBook(book('a', { file: big }))
    await saveBook(book('b'))
    const enc = await exportLibrary(undefined, 'pw')
    for (const b of await listBooks()) await deleteBook(b.id)

    expect(await importLibrary(enc, undefined, 'pw')).toBeDefined()
    expect((await getBook('a'))!.file.size).toBe(big.size)
    expect(await (await getBook('b'))!.file.text()).toBe('content-b')
  })
})
