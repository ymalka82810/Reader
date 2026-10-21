import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { epubDetails, epubOpening, htmlLines, opfMeta } from './bookText'

describe('htmlLines', () => {
  it('gives one line per block, with entities read', () => {
    const html = '<html><head><title>x</title><style>p{}</style></head><body><h1>גורלו של אפולו</h1><p>ספר&nbsp;שלישי<br/>המבוך &amp; הבוער</p></body></html>'
    expect(htmlLines(html)).toEqual(['גורלו של אפולו', 'ספר שלישי', 'המבוך & הבוער'])
  })
})

describe('epubOpening', () => {
  it('reads the first sections in spine order', async () => {
    const zip = new JSZip()
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
    zip.file(
      'OEBPS/content.opf',
      '<package><manifest><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="c" href="c.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    )
    zip.file('OEBPS/a.xhtml', '<html><body><p>ריק ריירדן</p></body></html>')
    zip.file('OEBPS/b.xhtml', '<html><body><p>בית האדם</p></body></html>')
    const file = await zip.generateAsync({ type: 'blob' })
    expect(await epubOpening(file)).toEqual(['ריק ריירדן', 'בית האדם'])
  })
})

describe('opfMeta', () => {
  it("reads calibre's series, the title, the authors and the identifiers", () => {
    const opf = `<package><metadata>
      <dc:title>גנב הברק</dc:title><dc:creator opf:role="aut">ריק ריירדן</dc:creator>
      <dc:identifier opf:scheme="ISBN">978-965-0-00000-4</dc:identifier><dc:identifier id="uuid">urn:uuid:1234</dc:identifier>
      <meta name="calibre:series" content="פרסי ג&apos;קסון"/><meta name="calibre:series_index" content="1.0"/>
    </metadata></package>`
    expect(opfMeta(opf)).toEqual({
      title: 'גנב הברק',
      authors: ['ריק ריירדן'],
      series: "פרסי ג'קסון",
      number: '1',
      identifiers: ['978-965-0-00000-4', 'urn:uuid:1234'],
    })
  })

  it("reads EPUB 3's series collection and its position, and skips a set that is not a series", () => {
    const opf = `<package><metadata><dc:title>האימפריה האחרונה</dc:title>
      <meta property="belongs-to-collection" id="s">קלאסיקות</meta><meta refines="#s" property="collection-type">set</meta>
      <meta property="belongs-to-collection" id="c">הערפילאים</meta>
      <meta refines="#c" property="collection-type">series</meta><meta refines="#c" property="group-position">2</meta>
    </metadata></package>`
    expect(opfMeta(opf)).toMatchObject({ series: 'הערפילאים', number: '2' })
  })

  it('leaves out a series index that is not a whole number', () => {
    const opf = '<package><meta name="calibre:series" content="ס"/><meta name="calibre:series_index" content="2.5"/></package>'
    expect(opfMeta(opf)).toMatchObject({ series: 'ס', number: '' })
  })
})

describe('epubDetails', () => {
  it('gives the opening and the package together', async () => {
    const zip = new JSZip()
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
    zip.file(
      'content.opf',
      '<package><metadata><dc:title>שם</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>',
    )
    zip.file('a.xhtml', '<html><body><p>שורה</p></body></html>')
    const got = await epubDetails(await zip.generateAsync({ type: 'blob' }))
    expect(got.opening).toEqual(['שורה'])
    expect(got.meta?.title).toBe('שם')
  })
})
