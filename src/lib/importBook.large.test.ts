import { describe, expect, it, vi } from 'vitest'

vi.mock('./db', () => ({
  contentId: async () => 'id1',
  hasBook: async () => false,
  listBooks: async () => [],
  saveBook: vi.fn(async () => {}),
  replaceBook: vi.fn(),
}))
const makeBook = vi.fn(async () => ({
  metadata: { title: 'Big', author: 'Me' },
  getCover: async () => undefined,
  destroy: () => {},
}))
vi.mock('foliate-js/view.js', () => ({ makeBook }))
const extractPdf = vi.fn()
vi.mock('./pdfToBook', () => ({ extractPdf }))

import { importFile, LARGE_PDF_BYTES, MAX_TXT_BYTES } from './importBook'

const pdf = (size: number) => {
  const f = new File(['%PDF-1.4'], 'big.pdf', { type: 'application/pdf' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('importFile: large PDFs and cancelling', () => {
  it('keeps a PDF over 20MB as it is, without starting the conversion', async () => {
    const f = pdf(LARGE_PDF_BYTES + 1)
    const rec = await importFile(f)
    expect(extractPdf).not.toHaveBeenCalled()
    expect(rec.file).toBe(f)
    expect(rec.fromPdf).toBe(true)
    expect(rec.title).toBe('Big')
  })

  it('stops at once when cancelled, even while a step cannot be interrupted', async () => {
    makeBook.mockImplementationOnce(() => new Promise(() => {})) // never settles
    const ctrl = new AbortController()
    const p = importFile(pdf(LARGE_PDF_BYTES + 1), undefined, undefined, ctrl.signal)
    setTimeout(() => ctrl.abort(), 10)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses a text file over the limit without reading it', async () => {
    const f = new File(['hello'], 'collection.txt', { type: 'text/plain' })
    Object.defineProperty(f, 'size', { value: MAX_TXT_BYTES + 1 })
    await expect(importFile(f)).rejects.toThrow(/גדול מדי/)
  })
})
