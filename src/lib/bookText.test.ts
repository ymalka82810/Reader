import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { epubOpening, htmlLines } from './bookText'

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
