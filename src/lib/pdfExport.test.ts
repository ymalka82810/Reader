// @vitest-environment jsdom
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { buildPdf, paragraphRtl, PdfScriptError, visualLine, visualWord } from './pdfExport'
import type { BookContent } from './bookExport'

vi.mock('./pdfFonts', () => {
  const f = (n: string) => new Uint8Array(readFileSync(`node_modules/@fontsource/heebo/files/heebo-${n}-normal.woff`))
  return {
    loadPdfFonts: async () => ({
      regular: [f('hebrew-400'), f('latin-400'), f('latin-ext-400')],
      bold: [f('hebrew-700'), f('latin-700'), f('latin-ext-700')],
    }),
  }
})

describe('visual order', () => {
  it('reverses a Hebrew word, keeping its nikud on its letter, its numbers and Latin as they read, brackets mirrored', () => {
    expect(visualWord('שלום')).toBe('םולש')
    expect(visualWord('שָׁלוֹם')).toBe('םוֹלשָׁ')
    expect(visualWord('שלום,')).toBe(',םולש')
    expect(visualWord('ב-1,000')).toBe('1,000-ב')
    expect(visualWord('(הערה)')).toBe('(הרעה)')
  })

  it('draws a right-to-left line from its last word, a run of Latin words keeping its order', () => {
    expect(visualLine(['אני', 'קורא', 'Harry', 'Potter', 'עכשיו'], true)).toEqual(['וישכע', 'Harry', 'Potter', 'ארוק', 'ינא'])
    expect(visualLine(['פרק', '12'], true)).toEqual(['12', 'קרפ'])
    expect(visualLine(['I', 'read', 'שלום', 'עולם', 'today'], false)).toEqual(['I', 'read', 'םלוע', 'םולש', 'today'])
  })

  it('takes a paragraph\u2019s direction from its first strong letter', () => {
    expect(paragraphRtl('2024 שנה', false)).toBe(true)
    expect(paragraphRtl('“Hello” שלום', true)).toBe(false)
    expect(paragraphRtl('1234', true)).toBe(true)
  })
})

const book = (text: string[]): BookContent => ({
  title: 'ספר בדיקה',
  author: 'מחבר',
  rtl: true,
  sections: [
    [{ t: 'h', level: 1, text: 'פרק ראשון' }, ...text.map((t) => ({ t: 'p' as const, text: t }))],
    [{ t: 'h', level: 2, text: 'פרק שני' }, { t: 'p', text: 'סוף.' }],
  ],
  images: new Map(),
})

describe('buildPdf', () => {
  it('writes a PDF with a page per section and the book\u2019s title', async () => {
    const long = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ. הארי פוטר (Harry Potter) יצא לאור ב-1997, ומכר יותר מ-500 מיליון עותקים — "הצלחה" עצומה! '
    const pdf = await buildPdf(book([long.repeat(6), 'פסקה שנייה, קצרה.']))
    const bytes = new Uint8Array(await pdf.arrayBuffer())
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, bytes)
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 5))).toBe('%PDF-')
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getTitle()).toBe('ספר בדיקה')
    expect(doc.getAuthor()).toBe('מחבר')
  })

  it('refuses a book in a script its fonts do not have', async () => {
    const ru = { ...book([]), rtl: false, sections: [[{ t: 'p' as const, text: 'Привет мир, это книга на русском языке. '.repeat(40) }]] }
    await expect(buildPdf(ru)).rejects.toThrow(PdfScriptError)
  })
})
