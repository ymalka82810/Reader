// @vitest-environment jsdom
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { ExportError, exportBook, exportFormats, readEpub, sectionBlocks, sourceFormat } from './bookExport'
import type { BookRecord } from './db'

const pdf = vi.hoisted(() => ({ extractPdf: vi.fn() }))
vi.mock('./pdfToBook', () => pdf)

async function epub(): Promise<Blob> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
  zip.file(
    'OEBPS/content.opf',
    '<package><manifest>' +
      '<item id="b" href="Text/b.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="a" href="Text/a.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="i" href="Images/p.png" media-type="image/png"/>' +
      '</manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
  )
  zip.file(
    'OEBPS/Text/a.xhtml',
    '<html><head><title>x</title><style>p{}</style></head><body><h1>פרק <span>ראשון</span></h1>' +
      '<p>שלום <b>עולם</b> &amp; חברים</p><p>שורה אחת<br/>שורה שנייה</p><div><img src="../Images/p.png" alt="ציור"/></div></body></html>',
  )
  zip.file('OEBPS/Text/b.xhtml', '<html><body><h2>פרק שני</h2><div>טקסט בתוך div</div></body></html>')
  zip.file('OEBPS/Images/p.png', new Uint8Array([137, 80, 78, 71]))
  return zip.generateAsync({ type: 'blob' })
}

const rec = (over: Partial<BookRecord> = {}): BookRecord => ({
  id: 'b1',
  title: 'הספר שלי',
  author: 'מחבר',
  kind: 'epub',
  file: new Blob(),
  fileName: 'x.epub',
  addedAt: 0,
  ...over,
})

const text = (b: Blob) => b.text()

describe('exportFormats', () => {
  it('offers an EPUB (also one converted on import) as Word, text and a web page, its own format first', () => {
    expect(exportFormats({ kind: 'epub', fileName: 'a.epub' })).toEqual(['epub', 'docx', 'txt', 'html'])
  })

  it('offers a PDF kept as it is also as an EPUB', () => {
    expect(exportFormats({ kind: 'epub', fileName: 'a.PDF' })).toEqual(['pdf', 'epub', 'docx', 'txt', 'html'])
    expect(sourceFormat({ kind: 'epub', fileName: 'a.pdf' })).toBe('pdf')
  })

  it('saves audio and the formats it reads only as they are', () => {
    expect(exportFormats({ kind: 'audio', fileName: 'a.m4b' })).toEqual([])
    expect(exportFormats({ kind: 'epub', fileName: 'a.mobi' })).toEqual([])
    expect(exportFormats({ kind: 'epub', fileName: 'a.cbz' })).toEqual([])
  })
})

describe('sectionBlocks', () => {
  it('keeps headings, paragraphs, line breaks and images in order, inline markup inside its paragraph', () => {
    const html = '<body><h1>פרק <i>א</i></h1><p>אחת <em>שתיים</em></p><p>א<br/>ב</p><figure><img src="../i/x.jpg"/></figure></body>'
    expect(sectionBlocks(html, 'OEBPS/t/a.xhtml')).toEqual([
      { t: 'h', level: 1, text: 'פרק א' },
      { t: 'p', text: 'אחת שתיים' },
      { t: 'p', text: 'א' },
      { t: 'p', text: 'ב' },
      { t: 'img', src: 'OEBPS/i/x.jpg', alt: '' },
    ])
  })
})

describe('readEpub', () => {
  it('reads the sections in spine order, with their images, and sees a Hebrew book as right to left', async () => {
    const c = await readEpub(await epub())
    expect(c.rtl).toBe(true)
    expect(c.sections).toHaveLength(2)
    expect(c.sections[0]![0]).toEqual({ t: 'h', level: 1, text: 'פרק ראשון' })
    expect(c.sections[1]).toEqual([
      { t: 'h', level: 2, text: 'פרק שני' },
      { t: 'p', text: 'טקסט בתוך div' },
    ])
    expect([...c.images.keys()]).toEqual(['OEBPS/Images/p.png'])
  })
})

describe('exportBook', () => {
  it('gives the stored file itself in its own format', async () => {
    const file = await epub()
    expect(await exportBook(rec({ file }), 'epub')).toBe(file)
  })

  it('writes plain text', async () => {
    const blob = await exportBook(rec({ file: await epub() }), 'txt')
    // a UTF-8 BOM first (text() drops it, so the bytes are read)
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const out = await text(blob)
    expect(out).toContain('פרק ראשון\n\n\nשלום עולם & חברים\n\nשורה אחת\n\nשורה שנייה')
    expect(out).toContain('* * *')
  })

  it('writes one web page, right to left, with the images inside it', async () => {
    const out = await text(await exportBook(rec({ file: await epub() }), 'html'))
    expect(out).toContain('<html lang="he" dir="rtl">')
    expect(out).toContain('<title>הספר שלי — מחבר</title>')
    expect(out).toContain('<h1>פרק ראשון</h1>')
    expect(out).toContain('<p>שלום עולם &amp; חברים</p>')
    expect(out).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="ציור"\/>/)
  })

  it('writes a Word document with right-to-left paragraphs, Word headings and a page per section', async () => {
    const zip = await JSZip.loadAsync(await exportBook(rec({ file: await epub() }), 'docx'))
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'docProps/core.xml']))
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('<w:pStyle w:val="Heading1"/><w:bidi/>')
    expect(doc).toContain('<w:pStyle w:val="Heading2"/>')
    expect(doc).toContain('שלום עולם &amp; חברים')
    expect(doc.match(/w:type="page"/g)).toHaveLength(1)
    expect(await zip.file('docProps/core.xml')!.async('string')).toContain('<dc:title>הספר שלי</dc:title>')
    // the XML parts are well formed
    for (const part of ['word/document.xml', 'word/styles.xml', 'docProps/core.xml', '[Content_Types].xml']) {
      const xml = new DOMParser().parseFromString(await zip.file(part)!.async('string'), 'application/xml')
      expect(xml.getElementsByTagName('parsererror')).toHaveLength(0)
    }
  })

  it('converts a PDF kept as it is the way an import does, and refuses one with no text', async () => {
    pdf.extractPdf.mockResolvedValueOnce({ title: 't', author: '', rtl: true, pageCount: 1, chapters: [{ title: 'עמ׳ 1', paras: ['שלום מה-PDF'] }] })
    const out = await text(await exportBook(rec({ fileName: 'a.pdf', fromPdf: true }), 'txt'))
    expect(out).toContain('שלום מה-PDF')
    pdf.extractPdf.mockResolvedValueOnce({ title: 't', author: '', rtl: false, pageCount: 1, chapters: [], keepOriginal: true })
    await expect(exportBook(rec({ fileName: 'a.pdf', fromPdf: true }), 'epub')).rejects.toThrow(ExportError)
  })
})
