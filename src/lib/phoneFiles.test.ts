import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { bookFileName, forgetPhoneFile, matchPhoneFiles, phoneFileOf, refreshPhoneFiles, rememberPhoneFile, syncPhoneNames } from './phoneFiles'

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor
})

const book = (over: Partial<Parameters<typeof bookFileName>[0]> = {}) => ({
  title: 'ספר',
  author: 'מחבר',
  fileName: 'old.epub',
  kind: 'epub' as const,
  ...over,
})

describe('bookFileName', () => {
  it('is "title - author" with the stored file\'s extension', () => {
    expect(bookFileName(book())).toBe('ספר - מחבר.epub')
    expect(bookFileName(book({ kind: 'other', fileName: 'x.MOBI' }))).toBe('ספר - מחבר.mobi')
  })

  it('names a converted PDF as the EPUB it now is', () => {
    expect(bookFileName(book({ kind: 'pdf', fromPdf: true, fileName: 'a.pdf' }))).toBe('ספר - מחבר.epub')
    expect(bookFileName(book({ kind: 'pdf', fileName: 'a.pdf' }))).toBe('ספר - מחבר.pdf')
  })

  it('leaves out an empty author and characters a file name cannot hold', () => {
    expect(bookFileName(book({ author: ' ', title: 'א/ב: ג?' }))).toBe('א_ב_ ג_.epub')
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
    expect(bookFileName(book({ kind: 'epub', fromPdf: true, fileName: 'a.epub' }), 'pdf')).toBe('ספר - מחבר.pdf')
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
