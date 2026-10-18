import { HEB, median, type Line } from './pdfLayout'

const FINALS = /[ךםןףץ]/

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

/**
 * True when the text extracted from a page is probably a poor stand-in for it: broken glyph mappings,
 * mostly non-letters (tables, formulas) or text shattered into tiny fragments. Near-empty pages are not poor.
 */
export function isPoorPage(lines: Line[]): boolean {
  const chars = lines.map((l) => l.text).join('').replace(/\s/g, '')
  if (chars.length < 20) return false
  const garbage = (chars.match(/[�-]/g) ?? []).length
  if (garbage > chars.length * 0.02) return true
  const letters = (chars.match(/\p{L}/gu) ?? []).length
  if (letters < chars.length * 0.5) return true
  return lines.length >= 10 && median(lines.map((l) => l.text.length)) < 12
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

/** True when every pixel (RGBA bytes) is white or nearly so: a blank page, or one pdf.js could not draw. */
export function isBlankPixels(data: ArrayLike<number>): boolean {
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) > 0 && ((data[i] ?? 255) < 248 || (data[i + 1] ?? 255) < 248 || (data[i + 2] ?? 255) < 248)) return false
  }
  return true
}
