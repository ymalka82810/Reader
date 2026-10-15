import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

const { buildEpub } = await import('./pdfToEpub')

const base = {
  title: 'ספר <בדיקה> & "עוד"',
  author: 'מחבר',
  rtl: true,
  pageCount: 3,
  chapters: [
    { title: 'פרק א', paras: ['שורה ראשונה', 'a < b & c'] },
    { title: 'ריק', paras: [] as string[] },
    { title: 'פרק ב', paras: ['שורה\u0001 שנייה'] },
  ],
}

const open = async (x = base) => JSZip.loadAsync(await (await buildEpub(x)).arrayBuffer())

describe('buildEpub', () => {
  it('writes the required EPUB structure with mimetype first', async () => {
    const zip = await open()
    expect(Object.keys(zip.files)[0]).toBe('mimetype')
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip')
    for (const f of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/toc.ncx'])
      expect(zip.file(f), f).toBeTruthy()
  })
  it('skips empty chapters', async () => {
    const zip = await open()
    expect(zip.file('OEBPS/c0.xhtml')).toBeTruthy()
    expect(zip.file('OEBPS/c2.xhtml')).toBeTruthy()
    expect(zip.file('OEBPS/c1.xhtml')).toBeNull()
  })
  it('escapes XML and strips illegal control characters', async () => {
    const zip = await open()
    expect(await zip.file('OEBPS/c0.xhtml')!.async('string')).toContain('<p>a &lt; b &amp; c</p>')
    const c1 = await zip.file('OEBPS/c2.xhtml')!.async('string')
    expect(c1).toContain('שורה שנייה')
    expect(c1).not.toContain('\u0001')
    expect(await zip.file('OEBPS/content.opf')!.async('string')).toContain(
      'ספר &lt;בדיקה&gt; &amp; &quot;עוד&quot;',
    )
  })
  it('emits namespace URIs intact (content filters once blanked them)', async () => {
    const opf = await (await open()).file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('xmlns="http://www.idpf.org/2007/opf"')
    expect(opf).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"')
  })
  it('sets language and direction from rtl', async () => {
    const zip = await open()
    expect(await zip.file('OEBPS/c0.xhtml')!.async('string')).toContain('dir="rtl"')
    const ltr = await open({ ...base, rtl: false })
    expect(await ltr.file('OEBPS/content.opf')!.async('string')).toContain('<dc:language>en</dc:language>')
  })
  it('omits the creator when there is no author', async () => {
    const opf = await (await open({ ...base, author: '' })).file('OEBPS/content.opf')!.async('string')
    expect(opf).not.toContain('dc:creator')
  })
  it('rejects a book with no text', async () => {
    await expect(buildEpub({ ...base, chapters: [{ title: 'x', paras: [] }] })).rejects.toThrow()
  })
})
