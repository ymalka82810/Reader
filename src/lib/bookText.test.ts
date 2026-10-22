import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { coverHref, epubDetails, epubOpening, htmlLines, opfMeta, runningHeads } from './bookText'

const ocr = vi.hoisted(() => ({ ocrLines: vi.fn() }))
vi.mock('./ocr', () => ocr)

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

describe('coverHref', () => {
  it("finds EPUB 3's cover-image, EPUB 2's cover meta, and an image named cover, in that order", () => {
    const item = (id: string, href: string, extra = '') => `<item id="${id}" href="${href}" media-type="image/jpeg" ${extra}/>`
    expect(coverHref(`<package><manifest>${item('a', 'old.jpg')}${item('b', 'new.jpg', 'properties="cover-image"')}</manifest></package>`)).toBe('new.jpg')
    expect(coverHref(`<package><meta name="cover" content="a"/><manifest>${item('a', 'front.jpg')}${item('c', 'cover2.jpg')}</manifest></package>`)).toBe('front.jpg')
    expect(coverHref(`<package><manifest>${item('p1', 'page1.jpg')}${item('p2', 'images/Cover.jpg')}</manifest></package>`)).toBe('images/Cover.jpg')
    expect(coverHref('<package><manifest><item id="t" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest></package>')).toBeUndefined()
  })
})

describe('epubDetails of a book with no text', () => {
  const build = async () => {
    const zip = new JSZip()
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
    zip.file(
      'content.opf',
      '<package><manifest><item id="p" href="p.xhtml" media-type="application/xhtml+xml"/><item id="c" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/></manifest><spine><itemref idref="p"/></spine></package>',
    )
    zip.file('p.xhtml', '<html><body><img src="cover.jpg"/></body></html>')
    zip.file('cover.jpg', new Uint8Array([1, 2, 3]))
    return zip.generateAsync({ type: 'blob' })
  }

  it("reads the cover image by OCR when the sections hold no text", async () => {
    ocr.ocrLines.mockResolvedValueOnce([['גנב הברק', 'ריק ריירדן']])
    const { opening } = await epubDetails(await build())
    expect(opening).toEqual(['גנב הברק', 'ריק ריירדן'])
    expect(ocr.ocrLines).toHaveBeenCalledOnce()
  })

  it('goes on with no opening when OCR cannot run', async () => {
    ocr.ocrLines.mockRejectedValueOnce(new Error('no wasm'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await epubDetails(await build())).opening).toEqual([])
    warn.mockRestore()
  })
})

describe('runningHeads', () => {
  it('finds the lines that open or close many pages, past their page numbers', () => {
    const words = 'אבגדהוזחטיכלמנסעפצקרשת'
    const text = (i: number) => `${words[i]}${words[i + 1]}ם הלך אל ${words[i]}ית`
    const pages = Array.from({ length: 20 }, (_, i) => (i % 2 ? [`${i + 10} מגדל הזהב`, text(i)] : ['הולי בלק וקסנדרה קלייר', text(i)]))
    expect(runningHeads(pages).sort()).toEqual(['הולי בלק וקסנדרה קלייר', 'מגדל הזהב'])
  })
  it('finds none in pages that only start and end with their text', () => {
    const words = 'אבגדהוזחטיכלמנסעפצקרשת'
    expect(runningHeads(Array.from({ length: 20 }, (_, i) => [`${words[i]}ל ${words[i + 1]}ר`, `${words[i + 2]}ם`]))).toEqual([])
  })
})
