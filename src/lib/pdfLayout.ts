import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface Line {
  text: string
  y: number
  h: number
  x0: number
  x1: number
}

export const HEB = /[֐-׿]/

/** One positioned text run as reported by pdf.js. */
export interface RawItem {
  str: string
  x: number
  y: number
  w: number
  h: number
  eol: boolean
}

/**
 * Some PDFs (typically produced by tools that mirror Hebrew text) store the page back to front: the
 * last word of the page first. Read in stream order the words, and the lines, then come out reversed.
 * When the runs clearly move up the page instead of down it, put them back in reading order.
 * Run-level "end of line" marks belong to the old order and are dropped; baselines decide the lines.
 */
export function normalizeStreamOrder(items: RawItem[]): RawItem[] {
  let down = 0
  let up = 0
  let prev: RawItem | null = null
  for (const it of items) {
    if (!it.str.trim()) continue
    if (prev) {
      const dy = it.y - prev.y
      if (Math.abs(dy) > Math.max(it.h, prev.h) * 0.5) {
        if (dy < 0) down++
        else up++
      }
    }
    prev = it
  }
  if (up < 8 || up < down * 3) return items
  return [...items].reverse().map((it) => ({ ...it, eol: false }))
}

/** Merge consecutive same-baseline runs into lines, in content-stream order. */
export function buildLines(items: RawItem[]): Line[] {
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

/**
 * True when the page holds a table: several rows in a row, each split into 3+ cells by wide gaps,
 * with the cells lining up in the same columns. Plain text, even in two columns, has no such rows.
 */
export function looksTabular(items: RawItem[]): boolean {
  const texts = items.filter((i) => i.str.trim())
  if (texts.length < 12) return false
  const rows: RawItem[][] = []
  for (const it of [...texts].sort((a, b) => b.y - a.y)) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0]!.y - it.y) <= it.h * 0.5) row.push(it)
    else rows.push([it])
  }
  const h = median(texts.map((i) => i.h)) || 10
  const tol = h * 1.5
  type Cell = { x0: number; x1: number }
  // a row's cells: runs separated by a gap far wider than a word space
  const cellsOf = (row: RawItem[]) => {
    const cells: Cell[] = []
    for (const it of [...row].sort((a, b) => a.x - b.x)) {
      const last = cells[cells.length - 1]
      if (last && it.x - last.x1 <= h * 1.5) last.x1 = Math.max(last.x1, it.x + it.w)
      else cells.push({ x0: it.x, x1: it.x + it.w })
    }
    return cells
  }
  const tabular = rows.map(cellsOf).filter((c) => c.length >= 3)
  if (tabular.length < 4) return false
  // columns: left edges (or right edges, for right-aligned numbers) shared by at least 4 rows
  const columns = (edge: (c: Cell) => number) => {
    const anchors: number[][] = []
    for (const cells of tabular)
      for (const c of cells) {
        const a = anchors.find((g) => Math.abs(g[0]! - edge(c)) <= tol)
        if (a) a.push(edge(c))
        else anchors.push([edge(c)])
      }
    return anchors.filter((g) => g.length >= 4).length >= 3
  }
  return columns((c) => c.x0) || columns((c) => c.x1)
}

/** Text runs of one PDF page, as pdf.js reports them. */
export async function rawItems(page: PDFPageProxy): Promise<RawItem[]> {
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
  return items
}

export function median(a: number[]): number {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)] ?? 0
}
