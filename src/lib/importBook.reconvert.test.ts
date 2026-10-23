import { describe, expect, it, vi } from 'vitest'
import type { BookMeta } from './db'

const { existing, saveReconverted, saveBook } = vi.hoisted(() => ({
  existing: { meta: undefined as BookMeta | undefined },
  saveReconverted: vi.fn(async () => {}),
  saveBook: vi.fn(async () => {}),
}))
vi.mock('./db', () => ({
  contentId: async () => 'id1',
  getBookMeta: async () => existing.meta,
  hasBook: async () => false,
  mergedInto: async () => undefined,
  listBooks: async () => [],
  saveBook,
  saveReconverted,
  replaceBook: vi.fn(),
}))
vi.mock('foliate-js/view.js', () => ({
  makeBook: async () => ({ metadata: { title: 'From the file', author: 'X' }, getCover: async () => undefined, destroy: () => {} }),
}))
vi.mock('./pdfToBook', () => ({
  extractPdf: async () => ({ title: 'T', author: '', rtl: true, pageCount: 1, chapters: [{ title: 'א', paras: ['שלום עולם'] }] }),
}))
vi.mock('./pdfToEpub', () => ({ buildEpub: async () => new Blob(['epub']) }))

import { importFile, PDF_CONVERSION } from './importBook'

const pdf = () => new File(['%PDF-1.4'], 'book.pdf', { type: 'application/pdf' })
const old = (over: Partial<BookMeta>): BookMeta => ({
  id: 'id1', title: 'שם שבחר המשתמש', author: 'מחבר', kind: 'epub', fileName: 'book.epub', addedAt: 1, fromPdf: true, folder: 'תיקייה', ...over,
})

describe('importFile: a PDF already in the library', () => {
  it('converts it afresh when an older conversion made its book, keeping what the user set', async () => {
    existing.meta = old({ cfi: 'epubcfi(/6/4)' })
    const rec = await importFile(pdf())
    expect(saveReconverted).toHaveBeenCalledOnce()
    expect(saveBook).not.toHaveBeenCalled()
    expect(rec).toMatchObject({ id: 'id1', title: 'שם שבחר המשתמש', folder: 'תיקייה', conv: PDF_CONVERSION, kind: 'epub' })
    expect(rec.cfi).toBeUndefined()
  })

  it('refuses it when the current conversion made its book', async () => {
    existing.meta = old({ conv: PDF_CONVERSION })
    await expect(importFile(pdf())).rejects.toThrow()
  })

  it('stamps a new conversion with its version', async () => {
    existing.meta = undefined
    const rec = await importFile(pdf())
    expect(rec.conv).toBe(PDF_CONVERSION)
  })
})
