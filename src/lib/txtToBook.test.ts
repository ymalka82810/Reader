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
  it('rejects a binary file with a .txt name', async () => {
    const bytes = new Uint8Array(4000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256
    await expect(extractTxt(txt(bytes))).rejects.toThrow()
    await expect(extractTxt(txt(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13, 73, 72, 68, 82])))).rejects.toThrow()
  })
  it('still accepts text in windows-1255 and UTF-8 with tabs and form feeds', async () => {
    const hebrew1255 = new Uint8Array([0xf9, 0xec, 0xe5, 0xed, 0x0d, 0x0a, 0xf2, 0xe5, 0xec, 0xed])
    expect((await extractTxt(txt(hebrew1255))).chapters[0]!.paras.length).toBeGreaterThan(0)
    expect((await extractTxt(txt('a\tb\fc\n\nd'))).chapters[0]!.paras.length).toBeGreaterThan(0)
  })
})
