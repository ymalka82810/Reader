// The opening of a book as plain lines: its first sections (an EPUB, also one converted from a PDF) or first pages (a PDF
// kept as it is). A book names itself there, on the title page and the copyright page, even when its file name is junk.
// An EPUB also names itself in its package (OPF): its title, authors, ISBNs and series (calibre's or EPUB 3's).

import type { BookMeta } from './db'
import { getFile } from './db'

/** how much of the book is read: enough for the half-title, the title page and the copyright page */
const SECTIONS = 6
const PAGES = 6
const MAX_LINES = 150

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  )

/** an (X)HTML section's text, one line per block */
export function htmlLines(html: string): string[] {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  return decode(
    body
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(?:p|div|h[1-6]|li|tr|td|section|header|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

const attr = (tag: string, name: string) => new RegExp(String.raw`\s${name}\s*=\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]

/** What an EPUB's package says about the book. `number` is the series index as a whole number, '' when there is none. */
export interface EpubMeta {
  title: string
  authors: string[]
  series: string
  number: string
  /** the identifiers' text (dc:identifier), where an ISBN is often kept */
  identifiers: string[]
}

const text = (s: string) => decode(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
const elements = (opf: string, tag: string) =>
  [...opf.matchAll(new RegExp(String.raw`<${tag}\b([^>]*?)(?<!/)>([\s\S]*?)</${tag}>`, 'gi'))].map((m) => ({ attrs: m[1]!, text: text(m[2]!) }))

/** "1", "1.0" or "01" as "1"; a fraction or anything else (a novella between books, "2.5") as '' */
function wholeNumber(s: string | undefined): string {
  const n = Number(s?.trim())
  return Number.isInteger(n) && n >= 1 && n <= 999 ? String(n) : ''
}

/** the package's title, authors, identifiers and series: calibre's `calibre:series` and `calibre:series_index`, or EPUB 3's
 *  `belongs-to-collection` (a series, or a collection of no stated type) with its `group-position` */
export function opfMeta(opf: string): EpubMeta {
  const meta = opf.match(/<(?:opf:)?meta\b[^>]*\/?>/gi) ?? []
  const named = (name: string) => meta.map((m) => (attr(m, 'name') === name ? attr(m, 'content') : undefined)).find((v) => v !== undefined)
  let series = text(named('calibre:series') ?? '')
  let number = series ? wholeNumber(named('calibre:series_index')) : ''
  if (!series) {
    const refines = elements(opf, '(?:opf:)?meta')
    for (const c of refines.filter((m) => attr(m.attrs, 'property') === 'belongs-to-collection')) {
      const id = attr(c.attrs, 'id')
      const about = (property: string) => refines.find((m) => attr(m.attrs, 'property') === property && id && attr(m.attrs, 'refines') === `#${id}`)?.text
      const type = about('collection-type')
      if (!c.text || (type && type !== 'series')) continue
      series = c.text
      number = wholeNumber(about('group-position'))
      break
    }
  }
  return {
    title: elements(opf, 'dc:title')[0]?.text ?? '',
    authors: elements(opf, 'dc:creator').map((e) => e.text).filter(Boolean),
    series,
    number,
    identifiers: elements(opf, 'dc:identifier').map((e) => e.text).filter(Boolean),
  }
}

/** the EPUB's first sections in reading order, and what its package says about it */
export async function epubDetails(file: Blob): Promise<{ opening: string[]; meta?: EpubMeta }> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  const container = (await zip.file('META-INF/container.xml')?.async('string')) ?? ''
  const opfPath = /<rootfile\s[^>]*>/i.exec(container)?.[0]
  const path = opfPath && attr(opfPath, 'full-path')
  const opf = path ? await zip.file(path)?.async('string') : undefined
  if (!path || !opf) return { opening: [] }
  const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  const hrefs = new Map<string, string>()
  for (const item of opf.match(/<item\b[^>]*>/gi) ?? []) {
    const id = attr(item, 'id')
    const href = attr(item, 'href')
    if (id && href && /html/i.test(attr(item, 'media-type') ?? 'html')) hrefs.set(id, href)
  }
  const spine = (opf.match(/<itemref\b[^>]*>/gi) ?? []).map((r) => attr(r, 'idref')).filter((id): id is string => !!id && hrefs.has(id))
  const lines: string[] = []
  for (const id of spine.slice(0, SECTIONS)) {
    const href = decodeURIComponent(hrefs.get(id)!.split('#')[0]!)
    const html = await zip.file(base + href)?.async('string')
    if (html) lines.push(...htmlLines(html))
    if (lines.length >= MAX_LINES) break
  }
  return { opening: lines.slice(0, MAX_LINES), meta: opfMeta(opf) }
}

/** the EPUB's first sections in reading order */
export async function epubOpening(file: Blob): Promise<string[]> {
  return (await epubDetails(file)).opening
}

/** a PDF's first pages, with Hebrew stored in visual order turned back */
async function pdfOpening(file: Blob, signal?: AbortSignal): Promise<string[]> {
  const [pdfjs, { default: workerUrl }, layout, { visualOrder, fixLine }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    import('./pdfLayout'),
    import('./pdfText'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: await file.arrayBuffer(), wasmUrl: new URL('pdfjs-wasm/', document.baseURI).href })
  try {
    const pdf = await task.promise
    const pages: Awaited<ReturnType<typeof layout.buildLines>>[] = []
    for (let i = 1; i <= Math.min(PAGES, pdf.numPages); i++) {
      signal?.throwIfAborted()
      const p = await pdf.getPage(i)
      pages.push(layout.readingGroups(layout.normalizeStreamOrder(await layout.rawItems(p))).flatMap(layout.buildLines))
      p.cleanup()
    }
    const order = visualOrder(pages)
    return pages.flat().map((l) => fixLine(l.text, order)).slice(0, MAX_LINES)
  } finally {
    void task.destroy().catch(() => {})
  }
}

/** What the book's file says about it: its opening lines, and an EPUB's package. Empty for an audiobook, a missing file
 *  or one that cannot be read. */
export async function bookDetails(b: Pick<BookMeta, 'id' | 'kind'>, signal?: AbortSignal): Promise<{ opening: string[]; meta?: EpubMeta }> {
  if (b.kind !== 'epub' && b.kind !== 'pdf') return { opening: [] }
  try {
    const file = await getFile(b.id)
    if (!file) return { opening: [] }
    return b.kind === 'epub' ? await epubDetails(file) : { opening: await pdfOpening(file, signal) }
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn(e)
    return { opening: [] }
  }
}
