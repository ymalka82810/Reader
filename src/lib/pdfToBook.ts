import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface Line {
  text: string
  y: number
  h: number
  x0: number
  x1: number
}

const HEB = /[\u0590-\u05FF]/
const FINALS = /[ךםןףץ]/
export const PAGES_PER_SECTION = 8

/** Extract lines of text from one PDF page, in content-stream order. */
async function extractLines(page: pdfjs.PDFPageProxy): Promise<Line[]> {
  const content = await page.getTextContent()
  const lines: Line[] = []
  let cur: Line | null = null
  for (const it of content.items) {
    if (!('str' in it)) continue
    const x = it.transform[4]
    const y = it.transform[5]
    const h = it.height || Math.abs(it.transform[3]) || 10
    if (!it.str && !it.hasEOL) continue
    if (cur && Math.abs(y - cur.y) <= h * 0.5) {
      cur.text += it.str
      cur.x0 = Math.min(cur.x0, x)
      cur.x1 = Math.max(cur.x1, x + it.width)
    } else {
      if (cur) lines.push(cur)
      cur = { text: it.str, y, h, x0: x, x1: x + it.width }
    }
    if (it.hasEOL && cur) {
      lines.push(cur)
      cur = null
    }
  }
  if (cur) lines.push(cur)
  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text)
}

/** Some Hebrew PDFs store text in visual order (reversed). Detect via final-letter positions. */
function looksReversed(allLines: Line[][]): boolean {
  let atStart = 0
  let atEnd = 0
  for (const lines of allLines)
    for (const l of lines)
      for (const w of l.text.split(' ')) {
        const heb = w.replace(/[^\u05D0-\u05EA]/g, '')
        if (heb.length < 2) continue
        if (FINALS.test(heb[heb.length - 1])) atEnd++
        if (FINALS.test(heb[0])) atStart++
      }
  return atStart > 5 && atStart > atEnd * 2
}

const MIRROR: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«',
}

function fixVisual(s: string): string {
  if (!HEB.test(s)) return s
  const rev = [...s].reverse().map((c) => MIRROR[c] ?? c).join('')
  // digit/latin runs were reversed too; flip them back
  return rev.replace(/[0-9A-Za-z][0-9A-Za-z.,:/%'-]*/g, (m) => [...m].reverse().join(''))
}

function median(a: number[]): number {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

/** Group a page's lines into paragraphs. */
function toParagraphs(lines: Line[], reversed: boolean): string[] {
  // drop bare page numbers at the top/bottom of the page
  const isNum = (l?: Line) => !!l && /^[\d\s\-–]{1,6}$/.test(l.text)
  let ls = lines
  if (isNum(ls[0])) ls = ls.slice(1)
  if (isNum(ls[ls.length - 1])) ls = ls.slice(0, -1)
  if (!ls.length) return []

  const gaps: number[] = []
  for (let i = 1; i < ls.length; i++) {
    const g = ls[i - 1].y - ls[i].y
    if (g > 0) gaps.push(g)
  }
  const normalGap = median(gaps) || ls[0].h * 1.2
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
    else if (/[A-Za-z\u05D0-\u05EA]-$/.test(buf) && !buf.endsWith('־')) buf = buf.slice(0, -1) + text
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
async function outlineStarts(pdf: pdfjs.PDFDocumentProxy): Promise<Map<number, string>> {
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
function detectHeadings(pages: Line[][], reversed: boolean): Map<number, string> {
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
      const big = l.h >= body * 1.3 && l.text.length <= 70 && !/[.,;]$/.test(l.text)
      const byName = named.test(l.text) && l.text.length <= 50
      if (big || byName) run.push(reversed ? fixVisual(l.text) : l.text)
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
): Promise<ExtractedPdf> {
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const pdf = await task.promise
  const total = pdf.numPages
  const pages: Line[][] = []
  for (let i = 1; i <= total; i++) {
    const p = await pdf.getPage(i)
    pages.push(await extractLines(p))
    p.cleanup()
    onProgress?.(i, total)
  }
  const info = ((await pdf.getMetadata().catch(() => null))?.info ?? {}) as Record<string, string>
  const bookmarks = await outlineStarts(pdf)
  await task.destroy()

  const chars = pages.flat().map((l) => l.text).join('')
  if (chars.replace(/\s/g, '').length < total * 20)
    throw new Error('ב-PDF הזה אין שכבת טקסט (כנראה סריקה). נדרש OCR, שעדיין לא נתמך.')

  const reversed = looksReversed(pages)
  const hebCount = (chars.match(/[֐-׿]/g) ?? []).length
  const rtl = hebCount > chars.length * 0.3

  let starts = bookmarks
  if (starts.size < 2) starts = detectHeadings(pages, reversed)

  const chapters: { title: string; paras: string[] }[] = []
  if (starts.size >= 2) {
    const marks = [...starts.keys()].sort((a, b) => a - b)
    if (marks[0] > 0) {
      marks.unshift(0)
      starts = new Map(starts).set(0, info.Title || fileName.replace(/\.pdf$/i, ''))
    }
    marks.forEach((from, i) => {
      const to = marks[i + 1] ?? total
      chapters.push({
        title: starts.get(from) ?? pageRange(from + 1, to),
        paras: pages.slice(from, to).flatMap((p) => toParagraphs(p, reversed)),
      })
    })
  } else {
    for (let start = 0; start < total; start += PAGES_PER_SECTION) {
      const end = Math.min(total, start + PAGES_PER_SECTION)
      chapters.push({
        title: pageRange(start + 1, end),
        paras: pages.slice(start, end).flatMap((p) => toParagraphs(p, reversed)),
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
