// A book's text laid out as a real PDF (selectable text, not pictures of pages): A5 pages, the cover first, every
// section on a new page, headings centered, paragraphs justified, page numbers at the foot, images in their place.
// The PDF writer (pdf-lib) only draws left to right, so a right-to-left line is put in visual order here: the words
// from right to left, the letters of a Hebrew word reversed (its nikud kept on its letter), numbers and Latin words
// left as they read, brackets mirrored.

import type { PDFDocument, PDFFont, PDFHexString, PDFImage, PDFName, PDFOperator, PDFPage } from 'pdf-lib'

type PdfLib = typeof import('pdf-lib')
import type { BookContent } from './bookExport'
import { tick } from './wordCount'

const PAGE_W = 419.53
const PAGE_H = 595.28
const MARGIN_X = 46
const MARGIN_TOP = 54
const MARGIN_BOTTOM = 62
const BODY = 11.5
const LEADING = 1.55
const HEADING_SIZE = [0, 19, 16, 14, 13, 12, 12]
const LINE_W = PAGE_W - 2 * MARGIN_X

/** letters that no font of the PDF has, out of all letters, past which the book is in a script it cannot be written in */
const MAX_MISSING = 0.15

export class PdfScriptError extends Error {
  constructor() {
    super('script')
  }
}

// ---------- direction ----------

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const LTR_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/
/** the parts of a right-to-left word that still read left to right: numbers (with their separators) and Latin words */
const LTR_PART = /[A-Za-z\u00C0-\u024F]+(?:['’.-][A-Za-z\u00C0-\u024F]+)*|\d+(?:[.,:/]\d+)*%?/g
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«', '‹': '›', '›': '‹' }

const clusters = (s: string) => s.match(/\P{M}\p{M}*/gu) ?? []

/** a run that reads right to left, in the order its letters are drawn left to right */
const reverseRun = (s: string) =>
  clusters(s)
    .reverse()
    .map((c) => MIRROR[c] ?? c)
    .join('')

/** one word of a right-to-left line, as drawn: its runs from right to left, the Hebrew ones reversed */
export function visualWord(word: string): string {
  const parts: string[] = []
  let at = 0
  for (const m of word.matchAll(LTR_PART)) {
    if (m.index > at) parts.push(reverseRun(word.slice(at, m.index)))
    parts.push(m[0])
    at = m.index + m[0].length
  }
  if (at < word.length) parts.push(reverseRun(word.slice(at)))
  return parts.reverse().join('')
}

type Dir = 'r' | 'l' | 'n'
const dirOf = (w: string): Dir => (RTL_CHAR.test(w) ? 'r' : LTR_CHAR.test(w) ? 'l' : 'n')

/** a paragraph reads right to left when its first strong letter does */
export function paragraphRtl(text: string, fallback: boolean): boolean {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return true
    if (LTR_CHAR.test(ch)) return false
  }
  return fallback
}

/** A line's words (in reading order) in the order they are drawn from left to right, each as it is drawn. */
export const visualLine = (words: string[], rtl: boolean): string[] => visualPairs(words, rtl).map((p) => p.drawn)

type Pair = { word: string; drawn: string }
const pair = (word: string): Pair => ({ word, drawn: visualWord(word) })

/** visualLine, each drawn word with the word it was */
function visualPairs(words: string[], rtl: boolean): Pair[] {
  if (!rtl) {
    // a left-to-right line: runs of right-to-left words are turned around in place
    const out: Pair[] = []
    let run: string[] = []
    const flush = () => {
      out.push(...run.reverse().map(pair))
      run = []
    }
    for (const w of words) {
      if (dirOf(w) === 'r' || (run.length && dirOf(w) === 'n')) run.push(w)
      else {
        flush()
        out.push({ word: w, drawn: w })
      }
    }
    flush()
    return out
  }
  // a right-to-left line: groups of left-to-right words keep their order inside, the groups go right to left
  const groups: Pair[][] = []
  let ltr: Pair[] = []
  let pendingNeutral: string[] = []
  const closeLtr = () => {
    if (ltr.length) groups.push(ltr)
    ltr = []
  }
  for (const w of words) {
    const d = dirOf(w)
    if (d === 'l') {
      // neutrals between two left-to-right words belong to them ("Harry Potter - 7")
      if (ltr.length) ltr.push(...pendingNeutral.map((n) => ({ word: n, drawn: n })))
      else for (const n of pendingNeutral) groups.push([pair(n)])
      pendingNeutral = []
      ltr.push({ word: w, drawn: w })
    } else if (d === 'n' && ltr.length) pendingNeutral.push(w)
    else {
      closeLtr()
      for (const n of pendingNeutral) groups.push([pair(n)])
      pendingNeutral = []
      groups.push([pair(w)])
    }
  }
  closeLtr()
  for (const n of pendingNeutral) groups.push([pair(n)])
  return groups.reverse().flat()
}

// ---------- fonts ----------

interface FontSet {
  fonts: PDFFont[]
  /** per font, whether it has a letter */
  has: ((cp: number) => boolean)[]
}

interface Fonts {
  regular: FontSet
  bold: FontSet
  missing: number
  letters: number
}

type Run = { text: string; font: PDFFont }

/** the runs a drawn word is written in: each letter (with its marks) in the first font that has it; letters no font has
 *  are left out and counted */
function runsOf(word: string, set: FontSet, f: Fonts): Run[] {
  const runs: Run[] = []
  for (const c of clusters(word)) {
    const cp = c.codePointAt(0)!
    const i = set.has.findIndex((has) => has(cp))
    if (/\p{L}/u.test(c)) f.letters++
    if (i < 0) {
      if (/\p{L}/u.test(c)) f.missing++
      continue
    }
    // the marks of a letter go in with it when its font has them
    const text = [...c].filter((ch, j) => j === 0 || set.has[i]!(ch.codePointAt(0)!)).join('')
    const font = set.fonts[i]!
    const last = runs[runs.length - 1]
    if (last?.font === font) last.text += text
    else runs.push({ text, font })
  }
  return runs
}

// ---------- layout ----------

interface Word {
  runs: Run[]
  width: number
}

class Writer {
  page!: PDFPage
  y = 0
  pageNo = 0
  /** whether anything was drawn on the current page */
  used = false
  private widths = new Map<PDFFont, Map<string, number>>()

  private doc: PDFDocument
  private f: Fonts
  private rtl: boolean
  private lib: PdfLib
  /** each run's glyphs, encoded once: the font engine's layout is the slow part of writing */
  private encoded = new Map<PDFFont, Map<string, PDFHexString>>()
  /** the name each font goes by on the current page */
  private keys = new Map<PDFFont, PDFName>()
  /** the text drawn on the current page, written into it as one block when the page is done */
  private ops: PDFOperator[] = []

  constructor(doc: PDFDocument, f: Fonts, rtl: boolean, lib: PdfLib) {
    this.doc = doc
    this.f = f
    this.rtl = rtl
    this.lib = lib
  }

  private draw(run: Run, x: number, y: number, size: number) {
    const { setFontAndSize, setTextMatrix, showText } = this.lib
    let key = this.keys.get(run.font)
    if (!key) this.keys.set(run.font, (key = this.page.node.newFontDictionary(run.font.name, run.font.ref)))
    let cache = this.encoded.get(run.font)
    if (!cache) this.encoded.set(run.font, (cache = new Map()))
    let hex = cache.get(run.text)
    if (!hex) cache.set(run.text, (hex = run.font.encodeText(run.text)))
    this.ops.push(setFontAndSize(key, size), setTextMatrix(1, 0, 0, 1, x, y), showText(hex))
  }

  /** opens a span whose text, for a reader copying or searching, is `text` */
  private actualText(text: string) {
    const { PDFOperator, PDFOperatorNames, PDFName, PDFHexString } = this.lib
    const props = this.doc.context.obj({ ActualText: PDFHexString.fromText(text) })
    return PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('Span'), props as unknown as PDFName])
  }

  /** writes the text gathered for the page into it */
  finishPage() {
    if (!this.ops.length || !this.page) return
    const { beginText, endText, pushGraphicsState, popGraphicsState } = this.lib
    this.page.pushOperators(pushGraphicsState(), beginText(), ...this.ops, endText(), popGraphicsState())
    this.ops = []
  }

  newPage() {
    this.finishPage()
    this.page = this.doc.addPage([PAGE_W, PAGE_H])
    this.keys.clear()
    this.pageNo++
    this.y = PAGE_H - MARGIN_TOP
    this.used = false
    // the page number, at the foot, in grey
    const n = String(this.pageNo)
    const font = this.f.regular.fonts[1] ?? this.f.regular.fonts[0]!
    const w = font.widthOfTextAtSize(n, 9)
    this.page.drawText(n, { x: (PAGE_W - w) / 2, y: MARGIN_BOTTOM / 2 - 3, size: 9, font, color: this.lib.rgb(0.45, 0.45, 0.45) })
  }

  private width(run: Run, size: number) {
    let cache = this.widths.get(run.font)
    if (!cache) this.widths.set(run.font, (cache = new Map()))
    let w = cache.get(run.text)
    if (w === undefined) cache.set(run.text, (w = run.font.widthOfTextAtSize(run.text, 1000)))
    return (w * size) / 1000
  }

  private runs = new Map<FontSet, Map<string, Run[]>>()

  private word(drawn: string, set: FontSet, size: number): Word {
    let cache = this.runs.get(set)
    if (!cache) this.runs.set(set, (cache = new Map()))
    let runs = cache.get(drawn)
    if (!runs) cache.set(drawn, (runs = runsOf(drawn, set, this.f)))
    return { runs, width: runs.reduce((n, r) => n + this.width(r, size), 0) }
  }

  /** room for `h` more points on this page, or a new page */
  ensure(h: number) {
    if (this.y - h < MARGIN_BOTTOM) this.newPage()
  }

  /** a paragraph (or a heading): broken into lines, justified unless `center`, right to left when its text is */
  text(text: string, { size, bold = false, center = false, before = 0, after = 0 }: { size: number; bold?: boolean; center?: boolean; before?: number; after?: number }) {
    const set = bold ? this.f.bold : this.f.regular
    const rtl = paragraphRtl(text, this.rtl)
    const line = size * LEADING
    const space = this.word(' ', set, size).width || size * 0.28
    const words = text.split(/\s+/).filter(Boolean)
    // every word measured once, as it is drawn (a word's width is the same in any order); a word wider than the line is cut
    const logical: string[] = []
    for (const w of words) {
      if (this.word(w, set, size).width <= LINE_W) logical.push(w)
      else {
        let piece = ''
        for (const c of clusters(w)) {
          if (piece && this.word(piece + c, set, size).width > LINE_W) {
            logical.push(piece)
            piece = ''
          }
          piece += c
        }
        if (piece) logical.push(piece)
      }
    }
    const lines: string[][] = []
    let cur: string[] = []
    let curW = 0
    for (const w of logical) {
      const ww = this.word(w, set, size).width
      if (cur.length && curW + space + ww > LINE_W) {
        lines.push(cur)
        cur = []
        curW = 0
      }
      curW += (cur.length ? space : 0) + ww
      cur.push(w)
    }
    if (cur.length) lines.push(cur)
    if (this.used && before) this.y -= before
    for (const [i, l] of lines.entries()) {
      this.ensure(line)
      const pairs = visualPairs(l, rtl)
      const drawn = pairs.map((p) => this.word(p.drawn, set, size))
      const total = drawn.reduce((n, w) => n + w.width, 0)
      const last = i === lines.length - 1
      let gap = space
      let x = MARGIN_X
      if (center) x = MARGIN_X + (LINE_W - total - space * (drawn.length - 1)) / 2
      else if (!last && drawn.length > 1 && (LINE_W - total) / (drawn.length - 1) < space * 3) gap = (LINE_W - total) / (drawn.length - 1)
      else if (rtl) x = MARGIN_X + LINE_W - total - space * (drawn.length - 1)
      const baseline = this.y - size
      for (const [j, w] of drawn.entries()) {
        // a word drawn in another order than it reads carries its real text, for copying and searching
        const real = pairs[j]!.word !== pairs[j]!.drawn ? pairs[j]!.word : undefined
        if (real) this.ops.push(this.actualText(real))
        for (const r of w.runs) {
          this.draw(r, x, baseline, size)
          x += this.width(r, size)
        }
        if (real) this.ops.push(this.lib.PDFOperator.of(this.lib.PDFOperatorNames.EndMarkedContent))
        x += gap
      }
      this.y -= line
      this.used = true
    }
    this.y -= after
  }

  /** an image, as wide as the line at most and no taller than the page */
  image(img: PDFImage) {
    const maxH = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM
    const scale = Math.min(1, LINE_W / img.width, maxH / img.height)
    const w = img.width * scale
    const h = img.height * scale
    this.ensure(h + 8)
    this.finishPage() // the text above it first, so the order on the page stays the reading order
    this.page.drawImage(img, { x: MARGIN_X + (LINE_W - w) / 2, y: this.y - h, width: w, height: h })
    this.y -= h + 10
    this.used = true
  }
}

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

/** an image the PDF can hold (JPEG or PNG); any other kind is drawn to a PNG first, where the browser can */
async function embedImage(doc: PDFDocument, blob: Blob): Promise<PDFImage | undefined> {
  try {
    let bytes = new Uint8Array(await blob.arrayBuffer())
    if (isJpeg(bytes)) return await doc.embedJpg(bytes)
    if (!isPng(bytes)) {
      if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return undefined
      const bmp = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(bmp.width, bmp.height)
      canvas.getContext('2d')!.drawImage(bmp, 0, 0)
      bmp.close()
      bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    }
    return await doc.embedPng(bytes)
  } catch {
    return undefined // a broken image does not stop the book
  }
}

/** The PDF of a book. `onProgress` tells the sections laid out so far. Throws a PdfScriptError when the book is in a
 *  script the PDF's fonts do not have (Arabic, Cyrillic). */
export async function buildPdf(
  c: BookContent,
  cover?: Blob,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const [lib, { default: fontkit }, { loadPdfFonts }] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
    import('./pdfFonts'),
  ])
  const files = await loadPdfFonts()
  const doc = await lib.PDFDocument.create()
  doc.registerFontkit(fontkit)
  // mark positioning is off: the nikud is drawn on its letter by the font itself, and the positioning tables of a
  // reversed word fail in the font engine
  const set = async (list: Uint8Array[]): Promise<FontSet> => ({
    fonts: await Promise.all(list.map((b) => doc.embedFont(b, { subset: true, features: { mark: false, mkmk: false } }))),
    has: list.map((b) => {
      const font = fontkit.create(b)
      return (cp: number) => font.hasGlyphForCodePoint(cp)
    }),
  })
  const fonts: Fonts = { regular: await set(files.regular), bold: await set(files.bold), missing: 0, letters: 0 }
  doc.setTitle(c.title)
  if (c.author) doc.setAuthor(c.author)
  doc.setLanguage(c.rtl ? 'he' : 'en')
  doc.setCreator('קורא ספרים')

  const w = new Writer(doc, fonts, c.rtl, lib)
  // the cover, alone on its page, as large as it fits
  const coverImg = cover && (await embedImage(doc, cover))
  if (coverImg) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    const scale = Math.min(PAGE_W / coverImg.width, PAGE_H / coverImg.height)
    const cw = coverImg.width * scale
    const ch = coverImg.height * scale
    page.drawImage(coverImg, { x: (PAGE_W - cw) / 2, y: (PAGE_H - ch) / 2, width: cw, height: ch })
  }
  w.newPage()
  const images = new Map<string, PDFImage | undefined>()
  for (const [i, s] of c.sections.entries()) {
    signal?.throwIfAborted()
    if (w.used) w.newPage()
    for (const b of s) {
      if (b.t === 'h') w.text(b.text, { size: HEADING_SIZE[b.level] ?? BODY, bold: true, center: true, before: BODY * 1.4, after: BODY * 0.7 })
      else if (b.t === 'p') w.text(b.text, { size: BODY, after: BODY * 0.45 })
      else {
        if (!images.has(b.src)) {
          const blob = c.images.get(b.src)
          images.set(b.src, blob && (await embedImage(doc, blob)))
        }
        const img = images.get(b.src)
        if (img) w.image(img)
      }
    }
    if (fonts.letters > 400 && fonts.missing / fonts.letters > MAX_MISSING) throw new PdfScriptError()
    onProgress?.(i + 1, c.sections.length)
    if (i % 5 === 4) await tick()
  }
  if (fonts.letters && fonts.missing / fonts.letters > MAX_MISSING) throw new PdfScriptError()
  w.finishPage()
  const out = await doc.save()
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}
