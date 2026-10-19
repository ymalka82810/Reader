import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { bookFileName, forgetPhoneFile, phoneFileOf, rememberPhoneFile, syncPhoneNames } from './phoneFiles'

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
