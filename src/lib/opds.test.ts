// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseFeed, pickAcquisition, safeUrl } from './opds'

const BASE = 'https://example.org/opds/'
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Catalog</title>
  <link rel="search" type="application/opensearchdescription+xml" href="/search.xml"/>
  <link rel="next" type="application/atom+xml" href="?page=2"/>
  <entry>
    <id>nav1</id><title>Authors</title>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="authors"/>
  </entry>
  <entry>
    <id>b1</id><title>Anna Karenina</title>
    <author><name>Leo Tolstoy</name></author>
    <summary>A novel</summary>
    <link rel="http://opds-spec.org/image/thumbnail" href="/c.jpg"/>
    <link rel="http://opds-spec.org/acquisition" type="application/pdf" href="/b1.pdf"/>
    <link rel="http://opds-spec.org/acquisition/open-access" type="application/epub+zip" href="/b1.epub"/>
    <link rel="http://opds-spec.org/acquisition" type="javascript/x" href="javascript:alert(1)"/>
  </entry>
</feed>`

describe('opds', () => {
  it('parses navigation and book entries, resolving relative links', () => {
    const f = parseFeed(feed, BASE)
    expect(f.title).toBe('Catalog')
    expect(f.search).toBe('https://example.org/search.xml')
    expect(f.next).toBe('https://example.org/opds/?page=2')
    expect(f.entries[0]!.nav).toBe('https://example.org/opds/authors')
    const book = f.entries[1]!
    expect(book.author).toBe('Leo Tolstoy')
    expect(book.cover).toBe('https://example.org/c.jpg')
    expect(book.acquisitions).toHaveLength(2) // the javascript: link is dropped
  })

  it('keeps a search template usable', () => {
    const f = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>t</title><link rel="search" type="application/atom+xml" href="/s?q={searchTerms}"/></feed>`,
      BASE,
    )
    expect(f.search).toBe('https://example.org/s?q={searchTerms}')
  })

  it('prefers EPUB over PDF', () => {
    const book = parseFeed(feed, BASE).entries[1]!
    expect(pickAcquisition(book)).toMatchObject({ ext: 'epub', href: 'https://example.org/b1.epub' })
  })

  it('rejects non-feed documents and non-web addresses', () => {
    expect(() => parseFeed('<html></html>', BASE)).toThrow()
    expect(() => parseFeed('not xml', BASE)).toThrow()
    expect(safeUrl('file:///etc/passwd', BASE)).toBeUndefined()
    expect(safeUrl('data:text/html,x', BASE)).toBeUndefined()
  })
})
