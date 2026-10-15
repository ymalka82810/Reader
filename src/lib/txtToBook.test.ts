import { describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

const { extractTxt } = await import('./txtToBook')

const txt = (content: string | Uint8Array, name = 'book.txt') =>
  new File([content as BlobPart], name, { type: 'text/plain' })

describe('extractTxt', () => {
  it('splits on blank lines and joins wrapped lines', async () => {
    const r = await extractTxt(txt('one\ntwo\n\nthree'))
    expect(r.chapters[0]!.paras).toEqual(['one two', 'three'])
  })
  it('treats each line as a paragraph when there are no blank lines', async () => {
    const r = await extractTxt(txt('a\r\nb\r\nc'))
    expect(r.chapters[0]!.paras).toEqual(['a', 'b', 'c'])
  })
  it('strips a BOM and uses the file name as title', async () => {
    const r = await extractTxt(txt('﻿hello', 'My Book.v2.txt'))
    expect(r.title).toBe('My Book.v2')
    expect(r.chapters[0]!.paras).toEqual(['hello'])
  })
  it('detects Hebrew as RTL and English as LTR', async () => {
    expect((await extractTxt(txt('שלום עולם, זה טקסט בעברית'))).rtl).toBe(true)
    expect((await extractTxt(txt('Just some English text'))).rtl).toBe(false)
  })
  it('falls back to Windows-1255 for old Hebrew files', async () => {
    // "שלום" in windows-1255
    const r = await extractTxt(txt(new Uint8Array([0xf9, 0xec, 0xe5, 0xed])))
    expect(r.chapters[0]!.paras).toEqual(['שלום'])
    expect(r.rtl).toBe(true)
  })
  it('splits long text into numbered chapters', async () => {
    const para = 'x'.repeat(5000)
    const r = await extractTxt(txt(Array(9).fill(para).join('\n\n')))
    expect(r.chapters.map((c) => c.title)).toEqual(['חלק 1', 'חלק 2', 'חלק 3'])
    expect(r.chapters.flatMap((c) => c.paras)).toHaveLength(9)
  })
  it('titles a single chapter after the file', async () => {
    expect((await extractTxt(txt('short'))).chapters[0]!.title).toBe('book')
  })
  it('rejects an empty file', async () => {
    await expect(extractTxt(txt('  \n\n '))).rejects.toThrow()
  })
})
