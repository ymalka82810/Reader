// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bookFileName, bookPhoneDir, forgetPhoneFile, placeBooksOnPhone, placeNewBook, matchPhoneFiles, phoneFileOf, phoneFilePathsInLibrary, placeVersions, tidyPhoneDuplicates, refreshPhoneFiles, rememberPhoneFile, saveBookToPhone, syncPhoneNames } from './phoneFiles'
import type { BookRecord } from './db'

// the test books, served in place of IndexedDB (whose fake loses a Blob's methods under jsdom)
const books = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./db', async (orig) => ({
  ...(await orig<typeof import('./db')>()),
  getBook: async (id: string) => books.get(id),
  getBookMeta: async (id: string) => books.get(id),
  listBooks: async () => [...books.values()],
}))
// a conversion needs a real EPUB; here it just yields a file
vi.mock('./bookExport', async (orig) => ({
  ...(await orig<typeof import('./bookExport')>()),
  exportBook: async () => new Blob(['converted']),
}))
const saveBook = (b: BookRecord) => books.set(b.id, b)

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor
})

const book = (over: Partial<Parameters<typeof bookFileName>[0]> = {}) => ({
  title: "פרסי ג'קסון 1 - גנב הברק",
  fileName: 'old.epub',
  kind: 'epub' as const,
  ...over,
})

describe('bookFileName', () => {
  it('is the title, in the naming template, with the stored file\'s extension', () => {
    expect(bookFileName(book())).toBe("פרסי ג'קסון 1 - גנב הברק.epub")
    expect(bookFileName(book({ kind: 'other', fileName: 'x.MOBI' }))).toBe("פרסי ג'קסון 1 - גנב הברק.mobi")
  })

  it('names the first book named after its series once', () => {
    expect(bookFileName(book({ title: 'שומרת הערים האבודות 1 - שומרת הערים האבודות' }))).toBe('שומרת הערים האבודות 1.epub')
  })

  it('names a converted PDF as the EPUB it now is, and a PDF kept as it is as a PDF', () => {
    expect(bookFileName(book({ fromPdf: true, fileName: 'a.epub' }))).toBe("פרסי ג'קסון 1 - גנב הברק.epub")
    expect(bookFileName(book({ fromPdf: true, fileName: 'a.pdf' }))).toBe("פרסי ג'קסון 1 - גנב הברק.pdf")
    expect(bookFileName(book({ fileName: 'a.mobi' }))).toBe("פרסי ג'קסון 1 - גנב הברק.mobi")
    expect(bookFileName(book({ fileName: 'a.epub' }), 'docx')).toBe("פרסי ג'קסון 1 - גנב הברק.docx")
    expect(bookFileName(book({ kind: 'pdf', fileName: 'a.pdf' }))).toBe("פרסי ג'קסון 1 - גנב הברק.pdf")
  })

  it('leaves out characters a file name cannot hold', () => {
    expect(bookFileName(book({ title: 'א/ב: ג?' }))).toBe('א_ב_ ג_.epub')
  })
})

describe('the remembered phone file', () => {
  it('is kept per book and can be forgotten', async () => {
    await rememberPhoneFile('b1', '/s/Download/a.epub')
    expect(await phoneFileOf('b1')).toBe('/s/Download/a.epub')
    await forgetPhoneFile('b1')
    expect(await phoneFileOf('b1')).toBeUndefined()
  })
})

describe('syncPhoneNames', () => {
  it('does nothing outside the Android app', async () => {
    expect(await syncPhoneNames(['b1'])).toEqual({ renamed: 0, failed: 0 })
  })
})

describe('refreshPhoneFiles', () => {
  it('does nothing outside the Android app', async () => {
    expect(await refreshPhoneFiles()).toBe(0)
  })
})

describe('bookFileName with the phone file\'s own extension', () => {
  it('keeps a PDF a PDF', () => {
    expect(bookFileName(book({ kind: 'epub', fromPdf: true, fileName: 'a.epub' }), 'pdf')).toBe("פרסי ג'קסון 1 - גנב הברק.pdf")
  })
})

const df = (path: string, size = 10) => ({ path, name: path.split('/').pop()!, size, modified: 1 })
const cand = (id: string, fileName: string, size: number | undefined, fromPdf = false) => ({
  id,
  fileName,
  fromPdf,
  size: async () => size,
})

describe('matchPhoneFiles', () => {
  it('ties a book to the file with its name and size, whatever the case of the name', async () => {
    const got = await matchPhoneFiles([cand('b1', 'a.epub', 10)], [df('/s/Download/A.EPUB', 10)])
    expect(got.get('b1')).toBe('/s/Download/A.EPUB')
  })

  it('tells same-named files apart by size, and leaves a tie alone', async () => {
    const files = [df('/s/x/a.epub', 5), df('/s/y/a.epub', 10)]
    expect((await matchPhoneFiles([cand('b1', 'a.epub', 10)], files)).get('b1')).toBe('/s/y/a.epub')
    expect((await matchPhoneFiles([cand('b1', 'a.epub', 7)], files)).size).toBe(0)
    expect((await matchPhoneFiles([cand('b1', 'a.epub', 5)], [df('/s/x/a.epub', 5), df('/s/y/a.epub', 5)])).size).toBe(0)
  })

  it('does not give one file to two books', async () => {
    const got = await matchPhoneFiles([cand('b1', 'a.epub', 10), cand('b2', 'a.epub', 10)], [df('/s/a.epub', 10)])
    expect([...got.keys()]).toEqual(['b1'])
  })

  it('ties a book converted from a PDF to its one PDF by name', async () => {
    expect((await matchPhoneFiles([cand('b1', 'a.epub', 99, true)], [df('/s/a.pdf', 10)])).get('b1')).toBe('/s/a.pdf')
    expect((await matchPhoneFiles([cand('b1', 'a.epub', 99, true)], [df('/s/x/a.pdf'), df('/s/y/a.pdf')])).size).toBe(0)
    expect((await matchPhoneFiles([cand('b1', 'a.epub', 99, false)], [df('/s/a.pdf')])).size).toBe(0)
  })
})

describe('bookPhoneDir with the library\'s names', () => {
  it('gives books of one library folder one phone folder, whatever their nikud', () => {
    const names = new Map([['סי ג\'יי דוהרטי', 'סי ג\'יי דוהרטי']])
    expect(bookPhoneDir({ author: 'סי ג\'יי דוֹהֶרטי' }, names)).toBe('סי ג\'יי דוהרטי')
    expect(bookPhoneDir({ author: 'סי ג\'יי דוהרטי' }, names)).toBe('סי ג\'יי דוהרטי')
  })
})

describe('bookPhoneDir', () => {
  it('is the book\'s library folder: the author, unless the user picked another folder', () => {
    expect(bookPhoneDir({ author: 'ריק ריירדן' })).toBe('ריק ריירדן')
    expect(bookPhoneDir({ author: 'ריק ריירדן', folder: "פרסי ג'קסון" })).toBe("פרסי ג'קסון")
  })

  it('leaves out characters a folder name cannot hold', () => {
    expect(bookPhoneDir({ author: 'א/ב: ג?' })).toBe('א_ב_ ג_')
  })

  it('has a folder of its own for books with no author', () => {
    expect(bookPhoneDir({ author: '' }).length).toBeGreaterThan(0)
    expect(bookPhoneDir({ author: 'x', folder: '' })).toBe(bookPhoneDir({ author: '' }))
  })
})

describe('the books folder outside the Android app', () => {
  it('places nothing', async () => {
    expect(await placeBooksOnPhone(['b1'])).toEqual({ placed: 0, failed: 0 })
    await expect(placeNewBook('b1')).resolves.toBeUndefined()
  })
})

/** a fake Android app: a DeviceBooks plugin that writes into `files` (path -> size) and records every call */
function fakePhone(files: Map<string, number>) {
  const calls: { method: string; options: Record<string, unknown> }[] = []
  ;(globalThis as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
    nativePromise: async (_plugin: string, method: string, options: Record<string, unknown> = {}) => {
      calls.push({ method, options })
      if (method === 'status') return { granted: true }
      if (method === 'save') {
        const path = (options.path as string) ?? `/s/${options.dir ? `Documents/קורא ספרים/${options.dir}` : 'Download'}/${options.name}`
        files.set(path, 1)
        return { path, name: path.split('/').pop(), size: 1, modified: 1 }
      }
      if (method === 'place') {
        const path = `/s/Documents/קורא ספרים/${options.dir}/${options.name}`
        files.delete(options.path as string)
        files.set(path, 1)
        return { path, name: options.name, size: 1, modified: 1 }
      }
      if (method === 'rename') {
        const dir = (options.path as string).slice(0, (options.path as string).lastIndexOf('/'))
        const path = `${dir}/${options.name}`
        files.delete(options.path as string)
        files.set(path, 1)
        return { path, name: options.name, size: 1, modified: 2 }
      }
      if (method === 'remove') {
        if (!files.delete(options.path as string)) throw new Error('remove')
        return undefined
      }
      return undefined
    },
  }
  return calls
}

const record = (over: Partial<BookRecord> = {}): BookRecord => ({
  id: 'p1',
  title: 'גנב הברק',
  author: 'ריק ריירדן',
  kind: 'epub',
  file: new Blob(['epub']),
  fileName: 'גנב הברק.epub',
  addedAt: 1,
  ...over,
})

describe('a book converted from a PDF, in the books folder', () => {
  it('keeps its EPUB there in place of the PDF', async () => {
    saveBook(record({ fromPdf: true }))
    const files = new Map([['/s/Download/גנב הברק.pdf', 5]])
    await rememberPhoneFile('p1', '/s/Download/גנב הברק.pdf')
    fakePhone(files)
    expect(await placeBooksOnPhone(['p1'])).toEqual({ placed: 1, failed: 0 })
    expect([...files.keys()]).toEqual(['/s/Documents/קורא ספרים/ריק ריירדן/גנב הברק.epub'])
    expect(await phoneFileOf('p1')).toBe('/s/Documents/קורא ספרים/ריק ריירדן/גנב הברק.epub')
  })
})

describe('downloading a book', () => {
  it('always saves it to Download, and leaves the book tied to its file in the books folder', async () => {
    saveBook(record({ id: 'd1' }))
    const inFolder = '/s/Documents/קורא ספרים/ריק ריירדן/גנב הברק.epub'
    await rememberPhoneFile('d1', inFolder)
    const calls = fakePhone(new Map([[inFolder, 1]]))
    expect(await saveBookToPhone('d1')).toBe('גנב הברק.epub')
    const save = calls.find((c) => c.method === 'save')
    expect(save?.options.dir).toBeUndefined()
    expect(calls.some((c) => c.method === 'place' || c.method === 'rename')).toBe(false)
    expect(await phoneFileOf('d1')).toBe(inFolder)
  })

  it('renames the Download copy when the book is renamed, and leaves the book\'s file in the books folder to its own sync', async () => {
    saveBook(record({ id: 'd2' }))
    const inFolder = '/s/Documents/קורא ספרים/ריק ריירדן/גנב הברק.epub'
    await rememberPhoneFile('d2', inFolder)
    const files = new Map([[inFolder, 1]])
    const calls = fakePhone(files)
    await saveBookToPhone('d2')
    const copy = '/s/Download/גנב הברק.epub'
    expect(files.has(copy)).toBe(true)
    // the book gets another name (an identification, an edit): both files follow it
    saveBook(record({ id: 'd2', title: 'פרסי ג\'קסון 2 - ים המפלצות' }))
    expect(await syncPhoneNames(['d2'])).toEqual({ renamed: 2, failed: 0 })
    expect(calls.filter((c) => c.method === 'rename').map((c) => c.options.path)).toContain(copy)
    expect(files.has("/s/Download/פרסי ג'קסון 2 - ים המפלצות.epub")).toBe(true)
    expect(files.has(copy)).toBe(false)
    // and only once: the next sync has nothing left to rename
    expect((await syncPhoneNames(['d2'])).renamed).toBe(0)
  })
})

describe('converted copies', () => {
  it('are filed under the author\'s versions folder, per format, on the next scan', async () => {
    saveBook(record({ id: 'v1' }))
    const files = new Map<string, number>()
    const calls = fakePhone(files)
    expect(await saveBookToPhone('v1', 'pdf')).toBe('גנב הברק.pdf')
    expect([...files.keys()]).toEqual(['/s/Download/גנב הברק.pdf'])
    expect(await placeVersions()).toBe(1)
    expect([...files.keys()]).toEqual(['/s/Documents/קורא ספרים/ריק ריירדן/גרסאות/PDF/גנב הברק.pdf'])
    expect(calls.some((c) => c.method === 'remove')).toBe(false)
    expect(await placeVersions()).toBe(0)
  })

  it('are forgotten when the book is gone, and never deleted', async () => {
    saveBook(record({ id: 'v2' }))
    const files = new Map<string, number>()
    const calls = fakePhone(files)
    await saveBookToPhone('v2', 'pdf')
    books.delete('v2')
    expect(await placeVersions()).toBe(0)
    expect(calls.some((c) => c.method === 'place' || c.method === 'remove')).toBe(false)
    expect(files.size).toBe(1)
  })
})

describe('tidyPhoneDuplicates', () => {
  const df = (path: string) => ({ path, name: path.split('/').pop()!, size: 1, modified: 1 })

  it('files the other format under the author\'s versions folder and deletes only the surplus the user approved', async () => {
    const keep = df('/s/Documents/קורא ספרים/ריק ריירדן/גנב הברק.epub')
    const pdf = df('/s/Download/גנב הברק.pdf')
    const a = df('/s/Download/גנב הברק (1).pdf')
    const b = df('/s/Download/גנב הברק (2).pdf')
    const files = new Map([keep, pdf, a, b].map((f) => [f.path, 1]))
    fakePhone(files)
    const r = await tidyPhoneDuplicates([{ title: 'גנב הברק', author: '', by: 'name', keep, versions: [pdf], surplus: [a, b] }], new Set([a.path]))
    expect(r).toEqual({ deleted: 1, moved: 1, failed: 0 })
    expect([...files.keys()].sort()).toEqual(
      [keep.path, b.path, '/s/Documents/קורא ספרים/ריק ריירדן/גרסאות/PDF/גנב הברק.pdf'].sort(),
    )
  })

  it('deletes nothing when nothing was approved, and keeps versions put when the author folder is unknown', async () => {
    const keep = df('/s/Download/ספר בלי מחבר.epub')
    const pdf = df('/s/Download/ספר בלי מחבר.pdf')
    const a = df('/s/Download/ספר בלי מחבר (1).pdf')
    const files = new Map([keep, pdf, a].map((f) => [f.path, 1]))
    const calls = fakePhone(files)
    const r = await tidyPhoneDuplicates([{ title: 'ספר בלי מחבר', author: '', by: 'name', keep, versions: [pdf], surplus: [a] }], new Set())
    expect(r).toEqual({ deleted: 0, moved: 0, failed: 0 })
    expect(calls.some((c) => c.method === 'remove' || c.method === 'place')).toBe(false)
    expect(files.size).toBe(3)
  })
})

describe('a book\'s versions follow it to another author\'s folder', () => {
  it('moves the filed PDF with the book, and leaves other books\' versions alone', async () => {
    saveBook(record({ id: 'w1', author: 'א' }))
    saveBook(record({ id: 'w2', author: 'ג', title: 'ספר אחר', fileName: 'ספר אחר.epub' }))
    const main = '/s/Documents/קורא ספרים/א/גנב הברק.epub'
    const other = '/s/Documents/קורא ספרים/ג/גרסאות/PDF/ספר אחר.pdf'
    const files = new Map<string, number>([[main, 1], [other, 1]])
    fakePhone(files)
    await rememberPhoneFile('w1', main)
    await saveBookToPhone('w1', 'pdf')
    expect(await placeVersions()).toBe(1)
    expect(files.has('/s/Documents/קורא ספרים/א/גרסאות/PDF/גנב הברק.pdf')).toBe(true)

    saveBook(record({ id: 'w1', author: 'ב' }))
    const r = await syncPhoneNames(['w1'])
    expect(r.failed).toBe(0)
    expect([...files.keys()].sort()).toEqual(
      [
        '/s/Documents/קורא ספרים/ב/גנב הברק.epub',
        '/s/Documents/קורא ספרים/ב/גרסאות/PDF/גנב הברק.pdf',
        other,
      ].sort(),
    )
    // the next sync has nothing left to move
    expect((await syncPhoneNames(['w1'])).failed).toBe(0)
  })
})

describe('phoneFilePathsInLibrary', () => {
  it('leaves out the files of books deleted from the library, so a retry offers them again', async () => {
    books.clear()
    books.set('kept', { id: 'kept' })
    await rememberPhoneFile('kept', 'Documents/kept.epub')
    await rememberPhoneFile('gone', 'Documents/gone.epub')
    const paths = await phoneFilePathsInLibrary()
    expect(paths.has('Documents/kept.epub')).toBe(true)
    expect(paths.has('Documents/gone.epub')).toBe(false)
  })
})

describe('two syncs of one book at the same moment', () => {
  it('move the file once, and the book stays tied to it, so a later rename still finds it', async () => {
    saveBook(record({ id: 'r1', title: 'גנב הברק' }))
    const files = new Map([['/s/Download/a1b2c3.epub', 1]])
    await rememberPhoneFile('r1', '/s/Download/a1b2c3.epub')
    fakePhone(files)
    // a file that is not there is reported as the real plugin does, and every call takes a moment
    const fake = (globalThis as unknown as { Capacitor: { nativePromise: (p: string, m: string, o?: Record<string, unknown>) => Promise<unknown> } }).Capacitor
    const inner = fake.nativePromise
    fake.nativePromise = async (plugin, method, options = {}) => {
      await new Promise((r) => setTimeout(r, 5))
      if ((method === 'place' || method === 'rename') && !files.has(options.path as string)) throw new Error('missing')
      return inner(plugin, method, options)
    }
    await Promise.all([syncPhoneNames(['r1']), syncPhoneNames(['r1'])])
    const inFolder = '/s/Documents/קורא ספרים/ריק ריירדן/גנב הברק.epub'
    expect(await phoneFileOf('r1')).toBe(inFolder)
    // the book is renamed later: its file in the books folder follows
    saveBook(record({ id: 'r1', title: 'ים המפלצות' }))
    expect(await syncPhoneNames(['r1'])).toEqual({ renamed: 1, failed: 0 })
    expect(files.has('/s/Documents/קורא ספרים/ריק ריירדן/ים המפלצות.epub')).toBe(true)
  })

  it('does not drop the link when the file it tried had already been moved by someone else', async () => {
    saveBook(record({ id: 'r2' }))
    const files = new Map<string, number>()
    await rememberPhoneFile('r2', '/s/Download/gone.epub')
    fakePhone(files)
    const fake = (globalThis as unknown as { Capacitor: { nativePromise: (p: string, m: string, o?: Record<string, unknown>) => Promise<unknown> } }).Capacitor
    const inner = fake.nativePromise
    fake.nativePromise = async (plugin, method, options = {}) => {
      if (method === 'place') {
        // while the move is tried, another part of the app has already tied the book to the file's new place
        await rememberPhoneFile('r2', '/s/Documents/קורא ספרים/ריק ריירדן/גנב הברק.epub')
        throw new Error('missing')
      }
      return inner(plugin, method, options)
    }
    await syncPhoneNames(['r2'])
    expect(await phoneFileOf('r2')).toBe('/s/Documents/קורא ספרים/ריק ריירדן/גנב הברק.epub')
  })
})
