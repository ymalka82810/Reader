// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { extractDocx } from './docxToBook'

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

async function docx(paras: string, core?: string, name = 'book.docx') {
  const zip = new JSZip()
  zip.file('word/document.xml', `<w:document ${NS}><w:body>${paras}</w:body></w:document>`)
  if (core) zip.file('docProps/core.xml', core)
  return new File([await zip.generateAsync({ type: 'uint8array' }) as BlobPart], name)
}

const p = (t: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`

describe('extractDocx', () => {
  it('reads paragraphs and skips empty ones', async () => {
    const r = await extractDocx(await docx(p('one') + '<w:p/>' + p('two')))
    expect(r.chapters[0]!.paras).toEqual(['one', 'two'])
    expect(r.title).toBe('book')
  })
  it('starts a chapter at each Heading1', async () => {
    const r = await extractDocx(await docx(p('A', 'Heading1') + p('x') + p('B', 'Heading1') + p('y')))
    expect(r.chapters.map((c) => c.title)).toEqual(['A', 'B'])
  })
  it('takes title and author from core properties', async () => {
    const core =
      '<cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><dc:creator>Me</dc:creator></cp:coreProperties>'
    const r = await extractDocx(await docx(p('שלום עולם'), core))
    expect([r.title, r.author, r.rtl]).toEqual(['T', 'Me', true])
  })
  it('rejects a file that is not a docx', async () => {
    await expect(extractDocx(new File(['nope'], 'x.docx'))).rejects.toThrow()
  })
})
