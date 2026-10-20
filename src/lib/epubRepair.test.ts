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

  describe('a missing package document', () => {
    const page = (t: string) => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${t}</title></head><body><p>${t}</p></body></html>`
    const NCX = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
      <head><meta name="dtb:uid" content="uid-123"/></head><docTitle><text>שם מהתוכן</text></docTitle>
      <navMap>
        <navPoint id="a"><navLabel><text>ב</text></navLabel><content src="p2.xhtml"/></navPoint>
        <navPoint id="b"><navLabel><text>חסר</text></navLabel><content src="p1.xhtml"/></navPoint>
        <navPoint id="c"><navLabel><text>ג</text></navLabel><content src="p3.xhtml#x"/></navPoint>
      </navMap></ncx>`

    async function damaged(extra: Record<string, string> = {}): Promise<File> {
      const zip = new JSZip()
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
      zip.file('META-INF/container.xml', CONTAINER) // points at OPF/content.opf, which is not in the zip
      zip.file('OPF/toc.ncx', NCX)
      zip.file('OPF/p2.xhtml', page('two'))
      zip.file('OPF/p3.xhtml', page('three'))
      zip.file('OPF/p4.xhtml', page('four'))
      zip.file('OPF/cover.png', 'png')
      zip.file('OPF/notes.txt', 'ignored')
      for (const [n, c] of Object.entries(extra)) zip.file(n, c)
      return new File([await zip.generateAsync({ type: 'blob' })], 'damaged.epub', { type: 'application/epub+zip' })
    }

    it('writes one from the table of contents: its order, its title, the pages it leaves out last', async () => {
      const out = await repairEpub(await damaged())
      const text = await opfOf(out)
      expect(text).toContain('<dc:title>שם מהתוכן</dc:title>')
      expect(text).toContain('uid-123')
      expect(text).toContain('properties="cover-image"')
      expect(text).not.toContain('notes.txt')
      const hrefs = [...text.matchAll(/<item id="(f\d+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]])
      const spine = [...text.matchAll(/<itemref idref="(f\d+)"/g)].map((m) => hrefs.find((h) => h[0] === m[1])![1])
      expect(spine).toEqual(['p2.xhtml', 'p3.xhtml', 'p4.xhtml'])
    })

    it('makes a book foliate-js can open, with the missing page only a dead link', async () => {
      const { makeBook } = await import('foliate-js/view.js')
      const src = await damaged()
      await expect(makeBook(src)).rejects.toThrow()
      const book = await makeBook(await repairEpub(src))
      expect(book.sections).toHaveLength(3)
      expect(book.metadata.title).toBe('שם מהתוכן')
      expect(book.toc).toHaveLength(3)
    })

    it('uses the nav page when there is no toc.ncx', async () => {
      const zip = new JSZip()
      zip.file('mimetype', 'application/epub+zip')
      zip.file('META-INF/container.xml', CONTAINER)
      zip.file('OPF/toc.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="b.xhtml">b</a></li><li><a href="a.xhtml">a</a></li></ol></nav></body></html>`)
      zip.file('OPF/a.xhtml', page('a'))
      zip.file('OPF/b.xhtml', page('b'))
      const out = await repairEpub(new File([await zip.generateAsync({ type: 'blob' })], 'nav.epub'))
      const text = await opfOf(out)
      expect(text).toContain('properties="nav"')
      const ids = [...text.matchAll(/<item id="(f\d+)" href="([^"]+)"/g)]
      const order = [...text.matchAll(/<itemref idref="(f\d+)"/g)].map((m) => ids.find((i) => i[1] === m[1])![2])
      expect(order).toEqual(['b.xhtml', 'a.xhtml'])
    })

    it('leaves the file alone when no page is left', async () => {
      const zip = new JSZip()
      zip.file('mimetype', 'application/epub+zip')
      zip.file('META-INF/container.xml', CONTAINER)
      zip.file('OPF/cover.png', 'png')
      const src = new File([await zip.generateAsync({ type: 'blob' })], 'empty.epub')
      expect(await repairEpub(src)).toBe(src)
    })
  })
})
