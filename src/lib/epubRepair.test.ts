// @vitest-environment jsdom
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { repairEpub } from './epubRepair'

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OPF/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const opf = (metadata: string) => `\uFEFF<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  ${metadata}
  <manifest>
    <item id="s1" href="s1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine page-progression-direction="rtl"><itemref idref="s1"/></spine>
</package>`

async function epub(metadata: string, name = 'book.epub'): Promise<File> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', CONTAINER)
  zip.file('OPF/content.opf', opf(metadata))
  zip.file('OPF/s1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>x</p></body></html>')
  return new File([await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })], name, {
    type: 'application/epub+zip',
  })
}

const opfOf = async (f: File) => (await JSZip.loadAsync(f)).file('OPF/content.opf')!.async('string')

describe('repairEpub', () => {
  it('gives an empty <metadata> a title and an identifier', async () => {
    const src = await epub('<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n  </metadata>', 'שם ספר.epub')
    const out = await repairEpub(src)
    expect(out).not.toBe(src)
    expect(out.name).toBe('שם ספר.epub')
    const text = await opfOf(out)
    expect(text).toContain('<dc:title')
    expect(text).toContain('שם ספר</dc:title>')
    expect(text).toContain('id="bookid"')
    expect(new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml').getElementsByTagName('parsererror')).toHaveLength(0)
  })

  it('handles a self-closing <metadata/>', async () => {
    const out = await repairEpub(await epub('<metadata/>'))
    expect(await opfOf(out)).toContain('<dc:title')
  })

  it('keeps the mimetype entry first and stored', async () => {
    const out = await repairEpub(await epub('<metadata></metadata>'))
    const zip = await JSZip.loadAsync(out)
    expect(Object.keys(zip.files)[0]).toBe('mimetype')
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip')
  })

  it('leaves an EPUB that already has metadata untouched', async () => {
    const src = await epub('<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>')
    expect(await repairEpub(src)).toBe(src)
  })

  it('returns anything that is not a readable EPUB as it came', async () => {
    const junk = new File(['not a zip'], 'x.epub')
    expect(await repairEpub(junk)).toBe(junk)
  })

  it('makes a metadata-less book openable by foliate-js', async () => {
    const { makeBook } = await import('foliate-js/view.js')
    const src = await epub('<metadata></metadata>')
    await expect(makeBook(src)).rejects.toThrow()
    const book = await makeBook(await repairEpub(src))
    expect(book.metadata.title).toBe('book')
    expect(book.dir).toBe('rtl')
  })
})
