import { buildLines, HEB, readingGroups, type Line, type RawItem } from './pdfLayout'
import { fixVisual } from './pdfText'

/*
 * Some Hebrew PDFs were made by tools that set the Hebrew text as if it were a left-to-right language: every line starts
 * at the left margin (the right edge is ragged), its pieces run from left to right in reading order, but each Hebrew
 * piece is stored with its letters reversed. Turning the whole line around, as for an ordinary reversed PDF, then puts
 * the pieces of the line in the wrong order and the punctuation on the wrong side ("נשמעו אנחות, וקצת צחקוקים." comes
 * out as "וקצת צחקוקים ,נשמעו אנחות."). Here every piece is turned around on its own and the pieces keep their order.
 *
 * Two more traces of the left-to-right layout are undone too:
 * - the punctuation at the edges of a line (a sentence's final period, a closing quote) stays at the line's left/right
 *   edge instead of moving with the text, so it shows up at the other end of the line (".מילה" for "מילה.");
 * - a line too long for its left-to-right box wraps from its logical end: the row below holds the line's beginning
 *   and the row above it the rest.
 */

const MIRROR: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«',
}
const flip = (s: string) => [...s].reverse().map((c) => MIRROR[c] ?? c).join('')

/** The runs of a page with each Hebrew run turned back to reading order; empty spacer runs (around nikud) are dropped. */
export function logicalItems(items: RawItem[]): RawItem[] {
  return items
    .filter((it) => !(it.w < 0.01 && it.str && !it.str.trim()))
    .map((it) => (HEB.test(it.str) ? { ...it, str: fixVisual(it.str) } : it))
}

const EDGE_START = /^[^\p{L}\p{N}\p{M}]+/u
const EDGE_END = /[^\p{L}\p{N}\p{M}]+$/u
/** punctuation that closes the word before it: at the right edge of a wrapped line's first row it is already in place */
const CLOSING = /^(?:[.,;:!?…)]|\s(?=[.,;:!?…]))*/u
const QUOTE = /["״”“]/

const isQuote = (c: string) => QUOTE.test(c)
/** a quote mark that opens or closes a quotation, not the gershayim inside an abbreviation (as in י"ב) */
const isMark = (s: string, i: number) => isQuote(s.charAt(i)) && !(/\p{L}/u.test(s.charAt(i - 1)) && /\p{L}/u.test(s.charAt(i + 1)))

/** whether a quotation is still open at the end of a text, given whether one was open at its start */
function quoteState(s: string, open: boolean): boolean {
  for (let i = 0; i < s.length; i++) if (isMark(s, i)) open = !open
  return open
}

/**
 * How badly a line's quote marks sit, taken in turn as opening and closing marks: an opening one belongs before a word
 * (after a space or the line's start), a closing one right after a word or its punctuation.
 */
function quoteMisfits(s: string, open: boolean): number {
  let bad = 0
  for (let i = 0; i < s.length; i++) {
    if (!isMark(s, i)) continue
    const before = s.charAt(i - 1)
    const after = s.charAt(i + 1)
    if (open) bad += Number(!before || /\s/.test(before) || /[\p{L}\p{N}]/u.test(after))
    else bad += Number((!!before && !/[\s(\-–]/.test(before)) || !after || /\s/.test(after))
    open = !open
  }
  return bad
}

/**
 * One line of a left-to-right laid PDF from its rows, its first row (the bottom one) first. The punctuation at the
 * line's own edges was left behind at the left/right edge: the line's final punctuation opens its last row, and the
 * marks the line starts with (an opening quote, a dialogue dash) close its first row, so both go back to their side.
 * Where the rows meet, the punctuation belongs to the text: a comma or period that ends the first row's last word, an
 * opening quote of the last row's first word. A quote mark there could be either, so the reading whose quote marks sit
 * properly (given whether a quotation was open before the line) is the one taken.
 */
export function fixLaidLine(rows: string[], quoteOpen = false): string {
  if (!rows.some((r) => HEB.test(r))) return rows.join(' ')
  const texts = rows.slice()
  const lastAt = texts.length - 1
  // the line's end, at the left of its last row
  const endRun = EDGE_START.exec(texts[lastAt]!)?.[0] ?? ''
  texts[lastAt] = texts[lastAt]!.slice(endRun.length)
  // the line's start, at the right of its first row
  const startRun = EDGE_END.exec(texts[0]!)?.[0] ?? ''
  texts[0] = texts[0]!.slice(0, texts[0]!.length - startRun.length)
  const build = (keepAtStart: number, keepAtEnd: number) => {
    const t = texts.slice()
    t[0] += startRun.slice(0, keepAtStart)
    t[lastAt] = endRun.slice(endRun.length - keepAtEnd) + t[lastAt]!
    const body = t.map((x) => x.trim()).filter(Boolean).join(' ')
    const lead = flip(startRun.slice(keepAtStart)).trimStart()
    const tail = flip(endRun.slice(0, endRun.length - keepAtEnd)).trimEnd()
    return (lead + body + tail).replace(/\s+/g, ' ').trim()
  }
  if (rows.length === 1) return build(0, 0)
  // candidates: how much of the first row's right edge stays with its last word, how much of the last row's left
  // edge is an opening mark of its first word; the first candidate of each is the usual case
  const closing = (CLOSING.exec(startRun)?.[0] ?? '').length
  const rest = startRun.slice(closing)
  const starts = isQuote(rest.charAt(0)) ? (isQuote(rest.charAt(1)) ? [closing + 1, closing] : [closing, closing + 1]) : [closing]
  const ends = isQuote(endRun.charAt(endRun.length - 1)) ? [0, 1] : [0]
  let best = ''
  let bestBad = Infinity
  for (const a of starts)
    for (const b of ends) {
      const line = build(a, b)
      const bad = quoteMisfits(line, quoteOpen)
      if (bad < bestBad) [best, bestBad] = [line, bad]
    }
  return best
}

/** The rows of one page of a left-to-right laid PDF, each Hebrew run in reading order (the rows not yet joined into lines). */
export function laidLines(items: RawItem[]): Line[] {
  return readingGroups(logicalItems(items)).flatMap(buildLines)
}

const BAD = /(?:^|\s)[.,!?;:][א-ת]/g
const GOOD = /[א-ת][.,!?;:](?=\s|$)/g
const count = (lines: string[], re: RegExp) => lines.reduce((n, s) => n + (s.match(re) ?? []).length, 0)

/**
 * True when a PDF whose letters are reversed reads properly only piece by piece: turned around line by line, its
 * punctuation clings to the start of the next word far more often than it ends a word, and piece by piece it does not.
 */
export function looksLaidLtr(whole: string[], rows: string[]): boolean {
  const pieces = rows.map((r) => fixLaidLine([r]))
  const badWhole = count(whole, BAD)
  const badPieces = count(pieces, BAD)
  return badWhole >= 20 && badWhole > badPieces * 4 && count(pieces, GOOD) > count(whole, GOOD)
}

/** how much of a wrapped line's length its widest row is taken to hold */
const WRAPPED_SHARE = 0.7

/** the most common distance between consecutive rows of the book */
function rowPitch(pages: Line[][]): number {
  const freq = new Map<number, number>()
  for (const lines of pages)
    for (let i = 1; i < lines.length; i++) {
      const g = Math.round(lines[i - 1]!.y - lines[i]!.y)
      if (g > 0) freq.set(g, (freq.get(g) ?? 0) + 1)
    }
  let best = 0
  let most = 0
  for (const [g, n] of freq) if (n > most) [best, most] = [g, n]
  return best
}

/**
 * Put back together the lines that wrapped in a left-to-right laid PDF: rows far closer to each other than the book's
 * usual line spacing are one line, read from the bottom row up. The merged line keeps the spacing to its neighbours,
 * so paragraphs are still found by their gaps.
 */
export function mergeWrappedRows(pages: Line[][]): Line[][] {
  const pitch = rowPitch(pages)
  if (!pitch) return pages
  const tight = (a: Line, b: Line) => {
    const g = a.y - b.y
    return g > 0 && g < pitch * 0.7 && Math.abs(a.h - b.h) <= a.h * 0.25
  }
  // the widest row is the width of the left-to-right box; a line that had to wrap is longer than that, one that fit is
  // shorter: a paragraph's last line (or a line set apart, a title), so it stays short next to the wrapped ones
  const box = Math.max(0, ...pages.flat().map((l) => l.x1 - l.x0))
  let open = false
  return pages.map((lines) => {
    const out: Line[] = []
    let prevBottom: number | null = null
    for (let i = 0; i < lines.length; ) {
      let j = i + 1
      while (j < lines.length && tight(lines[j - 1]!, lines[j]!)) j++
      const rows = lines.slice(i, j)
      const top = rows[0]!
      const text = fixLaidLine(rows.map((r) => r.text).reverse(), open)
      // a line that fit its row is a paragraph's last one, and a paragraph closes its quotations: a stray mark is not carried on
      if (rows.length === 1) open = false
      else open = quoteState(text, open)
      const last = out[out.length - 1]
      const y = last && prevBottom != null ? last.y - (prevBottom - top.y) : top.y
      const x0 = Math.min(...rows.map((r) => r.x0))
      const x1 = rows.length > 1 ? x0 + box / WRAPPED_SHARE : top.x1
      out.push({
        text,
        y,
        h: top.h,
        x0,
        x1,
      })
      prevBottom = rows[rows.length - 1]!.y
      i = j
    }
    return out
  })
}
