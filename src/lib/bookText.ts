// The opening of a book as plain lines: its first sections (an EPUB, also one converted from a PDF) or first pages (a PDF
// kept as it is). A book names itself there, on the title page and the copyright page, even when its file name is junk.
// An EPUB also names itself in its package (OPF): its title, authors, ISBNs and series (calibre's or EPUB 3's).

import type { BookMeta } from './db'
import { getFile } from './db'
import { namesIn, seriesLists, type SeriesList } from './bookInference'

/** how much of the book is read: enough for the half-title, the title page and the copyright page */
const SECTIONS = 6
const PAGES = 6
const MAX_LINES = 150
/** a book whose opening holds fewer letters than this has no text of its own to be identified by (a scan, a picture book) */
const MIN_LETTERS = 40
/** the pages read by OCR (the cover, the title page, the copyright page) and the width they are drawn at for it */
const OCR_PAGES = 3
const OCR_WIDTH = 1600
/** the pages past the opening whose first and last lines are compared for a running head */
const RUNNING_FROM = 8
const RUNNING_PAGES = 30
/** the sections past an EPUB's opening, and the lines of them at most, read for the names its story repeats */
const NAME_SECTIONS = 10
const NAME_LINES = 2500
/** the last sections or pages, and their last lines, read for a list of the series' books */
const END_SECTIONS = 2
const END_PAGES = 3
const END_LINES = 120

const letters = (lines: string[]) => lines.reduce((n, l) => n + (l.match(/[א-תA-Za-z]/g)?.length ?? 0), 0)

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
  /** a PDF's running head: a line repeated at the top or bottom of many pages (the book's title, its series or its
   *  author), most repeated first. Only a PDF has it, and only one that prints it. */
  running?: string[]
  /** the names the story repeats (its characters and places), read from its first chapters: what its books share with
   *  the other books of its series (namesIn) */
  names?: [string, number][]
  /** the lists of its series' books it prints ("ספרים נוספים בסדרה"), in its opening or its last pages */
  lists?: SeriesList[]
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

/** the package's cover image (EPUB 3's `cover-image` property, EPUB 2's `<meta name="cover">`, or an image named cover), as a path in the EPUB */
export function coverHref(opf: string): string | undefined {
  const items = (opf.match(/<item\b[^>]*>/gi) ?? []).map((i) => ({ id: attr(i, 'id'), href: attr(i, 'href'), type: attr(i, 'media-type') ?? '', props: attr(i, 'properties') ?? '' }))
  const images = items.filter((i) => i.href && /^image\//i.test(i.type))
  const metaId = (opf.match(/<(?:opf:)?meta\b[^>]*>/gi) ?? []).map((m) => (attr(m, 'name') === 'cover' ? attr(m, 'content') : undefined)).find(Boolean)
  return (
    images.find((i) => /(?:^|\s)cover-image(?:\s|$)/.test(i.props)) ??
    images.find((i) => metaId && i.id === metaId) ??
    images.find((i) => /cover/i.test(`${i.id ?? ''} ${i.href}`))
  )?.href
}

/** what OCR reads from the EPUB's cover image; empty when there is none, it cannot be read, or OCR cannot run */
async function coverLines(zip: { file(path: string): { async(type: 'blob'): Promise<Blob> } | null }, opf: string, base: string, signal?: AbortSignal): Promise<string[]> {
  const href = coverHref(opf)
  const entry = href ? zip.file(base + decodeURIComponent(href.split('#')[0]!)) : null
  if (!entry) return []
  try {
    const { ocrLines } = await import('./ocr')
    return (await ocrLines([await entry.async('blob')], signal))[0] ?? []
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn('OCR of the cover failed', e)
    return []
  }
}

/** the EPUB's first sections in reading order, and what its package says about it */
export async function epubDetails(file: Blob, signal?: AbortSignal): Promise<{ opening: string[]; meta?: EpubMeta }> {
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
  // a book of pictures (a scan made into an EPUB) names itself on its cover only: read that
  if (letters(lines) < MIN_LETTERS) lines.push(...(await coverLines(zip, opf, base, signal)))
  // the chapters after the opening, for the names the story repeats
  const story: string[] = []
  for (const id of spine.slice(SECTIONS, SECTIONS + NAME_SECTIONS)) {
    signal?.throwIfAborted()
    const html = await zip.file(base + decodeURIComponent(hrefs.get(id)!.split('#')[0]!))?.async('string')
    if (html) story.push(...htmlLines(html))
    if (story.length >= NAME_LINES) break
  }
  const names = namesIn([...lines, ...story].slice(0, MAX_LINES + NAME_LINES))
  // the last sections, where the other books of the series are often listed
  const end: string[] = []
  for (const id of spine.slice(Math.max(SECTIONS, spine.length - END_SECTIONS))) {
    const html = await zip.file(base + decodeURIComponent(hrefs.get(id)!.split('#')[0]!))?.async('string')
    if (html) end.push(...htmlLines(html).slice(-END_LINES))
  }
  const lists = seriesLists([...lines, ...end])
  return { opening: lines.slice(0, MAX_LINES), meta: { ...opfMeta(opf), ...(names.length && { names }), ...(lists.length && { lists }) } }
}

/** the EPUB's first sections in reading order */
export async function epubOpening(file: Blob): Promise<string[]> {
  return (await epubDetails(file)).opening
}

type PdfDoc = { numPages: number; getPage(n: number): Promise<import('pdfjs-dist/types/src/display/api').PDFPageProxy> }

/** the first pages of a PDF with no text layer, read by OCR; empty when OCR cannot run */
async function scannedOpening(pdf: PdfDoc, signal?: AbortSignal): Promise<string[]> {
  const draw = (n: number) => async () => {
    const page = await pdf.getPage(n)
    try {
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: OCR_WIDTH / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise
      return canvas
    } finally {
      page.cleanup()
    }
  }
  try {
    const { ocrLines } = await import('./ocr')
    const pages = Array.from({ length: Math.min(OCR_PAGES, pdf.numPages) }, (_, i) => draw(i + 1))
    return (await ocrLines(pages, signal)).flat().slice(0, MAX_LINES)
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn('OCR of the first pages failed', e)
    return []
  }
}

/** a PDF's first pages, with Hebrew stored in visual order turned back */
async function pdfOpening(
  file: Blob,
  signal?: AbortSignal,
): Promise<{ opening: string[]; running?: string[]; names?: [string, number][]; lists?: SeriesList[] }> {
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
    const lines = pages.flat().map((l) => fixLine(l.text, order)).slice(0, MAX_LINES)
    // a scan has no text layer: the first pages are drawn and read by OCR
    if (letters(lines) < MIN_LETTERS) return { opening: await scannedOpening(pdf, signal) }
    // the first and last lines of the pages further in, for a running head, and all their lines for the names
    const ends: string[][] = []
    const story: string[] = []
    for (let i = RUNNING_FROM; i < RUNNING_FROM + RUNNING_PAGES && i <= pdf.numPages; i++) {
      signal?.throwIfAborted()
      const p = await pdf.getPage(i)
      const page = layout.readingGroups(layout.normalizeStreamOrder(await layout.rawItems(p))).flatMap(layout.buildLines)
      p.cleanup()
      const texts = page.map((l) => fixLine(l.text, order))
      if (texts.length) ends.push([texts[0]!, texts[texts.length - 1]!])
      story.push(...texts)
    }
    const end: string[] = []
    for (let i = Math.max(RUNNING_FROM + RUNNING_PAGES, pdf.numPages - END_PAGES + 1); i <= pdf.numPages; i++) {
      signal?.throwIfAborted()
      const p = await pdf.getPage(i)
      end.push(...layout.readingGroups(layout.normalizeStreamOrder(await layout.rawItems(p))).flatMap(layout.buildLines).map((l) => fixLine(l.text, order)))
      p.cleanup()
    }
    return { opening: lines, running: runningHeads(ends), names: namesIn([...lines, ...story]), lists: seriesLists([...lines, ...end.slice(-END_LINES)]) }
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
    if (b.kind === 'epub') return await epubDetails(file, signal)
    const { opening, running, names, lists } = await pdfOpening(file, signal)
    return running?.length || names?.length || lists?.length
      ? {
          opening,
          meta: {
            ...(running?.length && { running }),
            ...(names?.length && { names }),
            ...(lists?.length && { lists }),
            title: '',
            authors: [],
            series: '',
            number: '',
            identifiers: [],
          },
        }
      : { opening }
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn(e)
    return { opening: [] }
  }
}

/** The lines that open or close many of these pages, past their page number: a running head ("מגדל הזהב" on every odd
 *  page, "הולי בלק" on every even one). A line counts when it is on a quarter of the pages and four at least; most
 *  repeated first. A chapter's title, which heads only its own pages, rarely gets there. */
export function runningHeads(pages: string[][]): string[] {
  const key = (s: string) =>
    s
      .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
      .replace(/\d+/g, ' ')
      .replace(/[^\p{L}\s'׳"״-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const counts = new Map<string, { text: string; n: number }>()
  for (const page of pages) {
    for (const k of new Set(page.map(key))) {
      if (!/\p{L}{2}/u.test(k) || k.split(' ').length > 8) continue
      const c = counts.get(k) ?? { text: k, n: 0 }
      c.n++
      counts.set(k, c)
    }
  }
  const needed = Math.max(4, Math.ceil(pages.length / 4))
  return [...counts.values()]
    .filter((c) => c.n >= needed)
    .sort((x, y) => y.n - x.n)
    .slice(0, 3)
    .map((c) => c.text)
}
