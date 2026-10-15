import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { ImportError } from './errors'


export interface Line {
  text: string
  y: number
  h: number
  x0: number
  x1: number
}

const HEB = /[\u0590-\u05FF]/
const FINALS = /[ךםןףץ]/
const PAGES_PER_SECTION = 8

/** One positioned text run as reported by pdf.js. */
export interface RawItem {
  str: string
  x: number
  y: number
  w: number
  h: number
  eol: boolean
}

/** Merge consecutive same-baseline runs into lines, in content-stream order. */
function buildLines(items: RawItem[]): Line[] {
  const lines: Line[] = []
  let cur: Line | null = null
  for (const it of items) {
    if (!it.str && !it.eol) continue
    if (cur && Math.abs(it.y - cur.y) <= it.h * 0.5) {
      cur.text += it.str
      cur.x0 = Math.min(cur.x0, it.x)
      cur.x1 = Math.max(cur.x1, it.x + it.w)
    } else {
      if (cur) lines.push(cur)
      cur = { text: it.str, y: it.y, h: it.h, x0: it.x, x1: it.x + it.w }
    }
    if (it.eol && cur) {
      lines.push(cur)
      cur = null
    }
  }
  if (cur) lines.push(cur)
  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text)
}

/** The widest empty vertical band in the middle of the page, if the page looks two-column. */
function findGutter(texts: RawItem[]): [number, number] | null {
  if (texts.length < 12) return null
  const minX = Math.min(...texts.map((i) => i.x))
  const maxX = Math.max(...texts.map((i) => i.x + i.w))
  const pw = maxX - minX
  if (pw <= 0) return null
  const lo = minX + pw * 0.3
  const hi = minX + pw * 0.7
  // full-width runs (titles, whole-line items) are handled separately as "crossers"
  const iv = texts
    .filter((i) => i.w < pw * 0.6)
    .map((i) => [i.x, i.x + i.w] as const)
    .sort((a, b) => a[0] - b[0])
  const minGap = Math.max(pw * 0.02, median(texts.map((i) => i.h)) * 1.2)
  let best: [number, number] | null = null
  const consider = (a: number, b: number) => {
    if (b - a >= minGap && (!best || b - a > best[1] - best[0])) best = [a, b]
  }
  let cursor = lo
  for (const [a, b] of iv) {
    if (b <= cursor) continue
    if (a >= hi) break
    if (a > cursor) consider(cursor, a)
    cursor = Math.max(cursor, b)
  }
  if (cursor < hi) consider(cursor, hi)
  return best
}

/**
 * Split a page's text runs into reading-order groups. Single-column pages come back as one group;
 * two-column pages as [column, column, …] (right column first for Hebrew), with full-width runs
 * (titles, spanning paragraphs) kept in their vertical position between the column bands.
 */
export function readingGroups(items: RawItem[]): RawItem[][] {
  const texts = items.filter((i) => i.str.trim())
  const gutter = findGutter(texts)
  if (!gutter) return [items]
  const [g0, g1] = gutter
  const mid = (g0 + g1) / 2
  const crosses = (i: RawItem) => i.x < g1 && i.x + i.w > g0
  const crossers = texts.filter(crosses).sort((a, b) => b.y - a.y)
  const side = (i: RawItem) => i.x + i.w / 2 < mid
  const sideItems = texts.filter((i) => !crosses(i))
  if (
    crossers.length > texts.length * 0.1 ||
    sideItems.filter(side).length < 6 ||
    sideItems.filter((i) => !side(i)).length < 6
  )
    return [items]
  const heb = texts.filter((i) => HEB.test(i.str)).length > texts.length / 2

  // consecutive crossers on one baseline form a single spanning line
  const spans: RawItem[][] = []
  for (const c of crossers) {
    const last = spans[spans.length - 1]
    if (last && Math.abs(last[0]!.y - c.y) <= c.h * 0.5) last.push(c)
    else spans.push([c])
  }
  const bands: RawItem[][] = Array.from({ length: spans.length + 1 }, () => [])
  for (const it of items) {
    if (crosses(it) && it.str.trim()) continue
    const k = spans.findIndex((s) => Math.abs(s[0]!.y - it.y) <= s[0]!.h * 0.5)
    if (k >= 0) spans[k]!.push(it)
    else bands[spans.filter((s) => s[0]!.y > it.y).length]!.push(it)
  }
  const out: RawItem[][] = []
  bands.forEach((band, k) => {
    const left = band.filter(side)
    const right = band.filter((i) => !side(i))
    for (const col of heb ? [right, left] : [left, right]) if (col.length) out.push(col)
    if (spans[k]) out.push(spans[k]!)
  })
  return out
}

/** Extract lines of text from one PDF page, in reading order. */
async function extractLines(page: PDFPageProxy): Promise<Line[]> {
  const content = await page.getTextContent()
  const items: RawItem[] = []
  for (const it of content.items) {
    if (!('str' in it)) continue
    items.push({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      h: it.height || Math.abs(it.transform[3]) || 10,
      eol: !!it.hasEOL,
    })
  }
  return readingGroups(items).flatMap(buildLines)
}

/** Digits vary page to page ("עמוד 7"), so compare repeated lines with numbers masked. */
const signature = (t: string) => t.replace(/[\d٠-٩]+/g, '#').replace(/\s+/g, ' ').trim()

/**
 * Remove running headers/footers: lines at the very top or bottom of a page whose text (digits
 * ignored) repeats on a good share of the pages. Also catches bare page numbers.
 */
export function stripRunningLines(pages: Line[][]): Line[][] {
  if (pages.length < 4) return pages
  const EDGE = 2
  const edgeOf = (lines: Line[]) =>
    lines.map((l, i) => ({ l, edge: i < EDGE || i >= lines.length - EDGE }))
  const seen = new Map<string, number>()
  for (const lines of pages) {
    const sigs = new Set<string>()
    for (const { l, edge } of edgeOf(lines)) if (edge) sigs.add(signature(l.text))
    for (const s of sigs) seen.set(s, (seen.get(s) ?? 0) + 1)
  }
  const min = Math.max(3, Math.ceil(pages.length * 0.25))
  const drop = new Set<string>()
  for (const [s, n] of seen) if (n >= min && /[#\p{L}]/u.test(s)) drop.add(s)
  if (!drop.size) return pages
  return pages.map((lines) =>
    edgeOf(lines)
      .filter(({ l, edge }) => !(edge && drop.has(signature(l.text))))
      .map(({ l }) => l),
  )
}

/**
 * Join per-page paragraphs into one list, merging a paragraph that runs over a page break
 * (the page ended without sentence-ending punctuation) and re-joining hyphenated words.
 */
export function joinPages(pages: string[][]): string[] {
  const out: string[] = []
  let open = false // the last paragraph in `out` may continue on the next page
  for (const paras of pages) {
    paras.forEach((p, i) => {
      if (i === 0 && open && out.length) {
        const prev = out[out.length - 1]!
        out[out.length - 1] = HYPHEN_END.test(prev) ? prev.slice(0, -1) + p : prev + ' ' + p
      } else out.push(p)
    })
    open = paras.length > 0 && !SENTENCE_END.test(paras[paras.length - 1]!)
  }
  return out
}

const SENTENCE_END = /[.!?:׃"”״)…]$/
const HYPHEN_END = /[A-Za-zא-ת][-­]$/

/** Some Hebrew PDFs store text in visual order (reversed). Detect via final-letter positions. */
export function looksReversed(allLines: Line[][]): boolean {
  let atStart = 0
  let atEnd = 0
  for (const lines of allLines)
    for (const l of lines)
      for (const w of l.text.split(' ')) {
        const heb = w.replace(/[^\u05D0-\u05EA]/g, '')
        if (heb.length < 2) continue
        if (FINALS.test(heb.charAt(heb.length - 1))) atEnd++
        if (FINALS.test(heb.charAt(0))) atStart++
      }
  return atStart > 5 && atStart > atEnd * 2
}

const MIRROR: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«',
}

export function fixVisual(s: string): string {
  if (!HEB.test(s)) return s
  const rev = [...s].reverse().map((c) => MIRROR[c] ?? c).join('')
  // digit/latin runs were reversed too; flip them back
  return rev.replace(/[0-9A-Za-z][0-9A-Za-z.,:/%'-]*/g, (m) => [...m].reverse().join(''))
}

function median(a: number[]): number {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)] ?? 0
}

/** Group a page's lines into paragraphs. */
export function toParagraphs(lines: Line[], reversed: boolean): string[] {
  // drop bare page numbers at the top/bottom of the page
  const isNum = (l?: Line) => !!l && /^[\d\s\-–]{1,6}$/.test(l.text)
  let ls = lines
  if (isNum(ls[0])) ls = ls.slice(1)
  if (isNum(ls[ls.length - 1])) ls = ls.slice(0, -1)
  if (!ls.length) return []

  const gaps: number[] = []
  for (let i = 1; i < ls.length; i++) {
    const g = ls[i - 1]!.y - ls[i]!.y
    if (g > 0) gaps.push(g)
  }
  const normalGap = median(gaps) || (ls[0]?.h ?? 0) * 1.2
  const maxW = Math.max(...ls.map((l) => l.x1 - l.x0))

  const paras: string[] = []
  let buf = ''
  let prev: Line | null = null
  for (const l of ls) {
    const text = reversed ? fixVisual(l.text) : l.text
    if (prev) {
      const gap = prev.y - l.y
      const prevShort = prev.x1 - prev.x0 < maxW * 0.72
      const prevEnds = /[.!?:׃"”״)]$/.test(buf)
      const bigGap = gap > normalGap * 1.45 || gap < 0
      if (bigGap || (prevShort && prevEnds)) {
        paras.push(buf)
        buf = ''
      }
    }
    if (!buf) buf = text
    else if (HYPHEN_END.test(buf)) buf = buf.slice(0, -1) + text
    else buf += ' ' + text
    prev = l
  }
  if (buf) paras.push(buf)
  return paras
}

export interface ExtractedPdf {
  title: string
  author: string
  rtl: boolean
  pageCount: number
  /** one entry per future EPUB chapter: a real heading when found, else a page range */
  chapters: { title: string; paras: string[] }[]
}

/** Legacy: books imported before the PDF→EPUB conversion store ready-made HTML sections. */
export interface LegacyPdfBook {
  title: string
  author: string
  rtl: boolean
  pageCount: number
  sections: string[]
}

const pageRange = (from: number, to: number) => (from === to ? `עמוד ${from}` : `עמודים ${from}–${to}`)

/** Chapter start pages (0-based) taken from the PDF's own bookmarks, if it has any. */
async function outlineStarts(pdf: PDFDocumentProxy): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  try {
    const outline = await pdf.getOutline()
    if (!outline?.length) return out
    const walk = async (items: typeof outline, depth: number) => {
      for (const it of items) {
        try {
          let dest = it.dest
          if (typeof dest === 'string') dest = await pdf.getDestination(dest)
          const ref = Array.isArray(dest) ? dest[0] : null
          const page = ref == null ? -1 : typeof ref === 'number' ? ref : await pdf.getPageIndex(ref)
          const title = it.title.replace(/\s+/g, ' ').trim()
          if (page >= 0 && title && !out.has(page)) out.set(page, title)
        } catch {
          /* unresolvable bookmark: skip */
        }
        if (depth < 2 && it.items?.length) await walk(it.items, depth + 1)
      }
    }
    await walk(outline, 1)
  } catch {
    /* no outline */
  }
  return out
}

/** Guess chapter headings from big, short lines (or "פרק …"/"Chapter …" lines) when there are no bookmarks. */
export function detectHeadings(pages: Line[][], reversed: boolean): Map<number, string> {
  const hs = pages.flat().map((l) => l.h)
  const body = median(hs)
  const out = new Map<number, string>()
  if (!body) return out
  const named = /^(פרק|שער|חלק|מבוא|הקדמה|Chapter|Part|CHAPTER|PART)(\s|$)/
  const cands: { page: number; text: string }[] = []
  pages.forEach((lines, page) => {
    // headings sit in the upper part of the page; take the first qualifying run of lines
    const top = lines.slice(0, 6)
    const run: string[] = []
    for (const l of top) {
      // a reversed line only matches the "פרק …" pattern once put back in logical order
      const text = reversed ? fixVisual(l.text) : l.text
      const big = l.h >= body * 1.3 && l.text.length <= 70 && !/[.,;]$/.test(text)
      const byName = named.test(text) && l.text.length <= 50
      if (big || byName) run.push(text)
      else if (run.length) break
    }
    const text = run.join(' ').trim()
    if (text.length >= 2 && !/^[\d\s\-–]+$/.test(text)) cands.push({ page, text })
  })
  // a heading repeated on many pages is a running header, not a chapter title
  const freq = new Map<string, number>()
  for (const c of cands) freq.set(c.text, (freq.get(c.text) ?? 0) + 1)
  for (const c of cands) if ((freq.get(c.text) ?? 0) <= 2) out.set(c.page, c.text)
  // too many "headings" means the heuristic is catching ordinary text
  return out.size > Math.max(40, pages.length / 2) ? new Map() : out
}

/** Extract the text of a PDF as paragraphs, grouped into chapters. */
export async function extractPdf(
  file: Blob,
  fileName: string,
  onProgress?: (done: number, total: number) => void,
  onOcrProgress?: (done: number, total: number) => void,
): Promise<ExtractedPdf> {
  // pdf.js is heavy; load it only when a PDF is actually imported.
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const pdf = await task.promise
  const total = pdf.numPages
  let pages: Line[][] = []
  let info: Record<string, string>
  let bookmarks: Map<number, string>
  try {
    for (let i = 1; i <= total; i++) {
      const p = await pdf.getPage(i)
      pages.push(await extractLines(p))
      p.cleanup()
      onProgress?.(i, total)
    }
    info = ((await pdf.getMetadata().catch(() => null))?.info ?? {}) as Record<string, string>
    bookmarks = await outlineStarts(pdf)

    const hasText = () => pages.flat().map((l) => l.text).join('').replace(/\s/g, '').length >= total * 20
    // a scan has no text layer: read the page images instead (the pdf must stay open for this)
    if (!hasText()) {
      try {
        pages = await (await import('./ocr')).ocrPdf(pdf, onOcrProgress)
      } catch (e) {
        console.error(e)
        throw new ImportError('ה-PDF הוא סריקה, והזיהוי האוטומטי של הטקסט (OCR) נכשל. בדקו את החיבור לאינטרנט ונסו שוב.')
      }
      if (!hasText()) throw new ImportError('לא הצלחנו לזהות טקסט ב-PDF הסרוק הזה.')
    }
  } finally {
    await task.destroy()
  }

  const chars = pages.flat().map((l) => l.text).join('')

  const reversed = looksReversed(pages)
  const hebCount = (chars.match(/[֐-׿]/g) ?? []).length
  const rtl = hebCount > chars.length * 0.3

  // repeated headers/footers would otherwise leak into the text and fake chapter headings
  const body = stripRunningLines(pages)
  const chapterParas = (from: number, to: number) =>
    joinPages(body.slice(from, to).map((p) => toParagraphs(p, reversed)))

  let starts = bookmarks
  if (starts.size < 2) starts = detectHeadings(body, reversed)

  const chapters: { title: string; paras: string[] }[] = []
  if (starts.size >= 2) {
    const marks = [...starts.keys()].sort((a, b) => a - b)
    if ((marks[0] ?? 0) > 0) {
      marks.unshift(0)
      starts = new Map(starts).set(0, info.Title || fileName.replace(/\.pdf$/i, ''))
    }
    marks.forEach((from, i) => {
      const to = marks[i + 1] ?? total
      chapters.push({
        title: starts.get(from) ?? pageRange(from + 1, to),
        paras: chapterParas(from, to),
      })
    })
  } else {
    for (let start = 0; start < total; start += PAGES_PER_SECTION) {
      const end = Math.min(total, start + PAGES_PER_SECTION)
      chapters.push({
        title: pageRange(start + 1, end),
        paras: chapterParas(start, end),
      })
    }
  }
  return {
    title: info.Title || fileName.replace(/\.pdf$/i, ''),
    author: info.Author || '',
    rtl,
    pageCount: total,
    chapters,
  }
}

/** Legacy: wrap stored HTML sections in the minimal "book" interface foliate-js renders. */
export function bookFromSections(x: LegacyPdfBook) {
  const urls = new Map<number, string>()
  const sections = x.sections.map((html, i) => ({
    id: `s${i}`,
    size: new Blob([html]).size,
    load: () => {
      if (!urls.has(i)) urls.set(i, URL.createObjectURL(new Blob([html], { type: 'text/html' })))
      return urls.get(i)
    },
    unload: () => {
      const u = urls.get(i)
      if (u) URL.revokeObjectURL(u)
      urls.delete(i)
    },
    createDocument: () => new DOMParser().parseFromString(html, 'text/html'),
  }))
  const book: any = {}
  book.metadata = { title: x.title, author: x.author, language: x.rtl ? 'he' : 'en' }
  book.dir = x.rtl ? 'rtl' : 'ltr'
  book.sections = sections
  book.toc = sections.map((s, i) => ({
    label: `עמודים ${i * PAGES_PER_SECTION + 1}–${Math.min(x.pageCount, (i + 1) * PAGES_PER_SECTION)}`,
    href: s.id,
  }))
  book.resolveHref = (href: string) => ({ index: sections.findIndex((s) => s.id === href) })
  book.splitTOCHref = (href: string) => [href, null]
  book.getTOCFragment = (doc: Document) => doc.documentElement
  book.destroy = () => urls.forEach((u) => URL.revokeObjectURL(u))
  return book
}
