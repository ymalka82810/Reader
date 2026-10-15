import { describe, expect, it, vi } from 'vitest'

// the worker URL import and pdf.js itself aren't needed for the pure text logic
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

const { detectHeadings, fixVisual, looksReversed, toParagraphs } = await import('./pdfToBook')
type Line = import('./pdfToBook').Line

const MIRROR: Record<string, string> = { '(': ')', ')': '(' }
/** how a logical-order string is stored in a visual-order PDF: reversed, with brackets mirrored */
const rev = (s: string) =>
  [...s]
    .reverse()
    .map((c) => MIRROR[c] ?? c)
    .join('')
const line = (text: string, y: number, over: Partial<Line> = {}): Line => ({
  text,
  y,
  h: 10,
  x0: 0,
  x1: 400,
  ...over,
})

describe('looksReversed', () => {
  const logical = 'הילדים הלכו לבית הספר ביחד עם החברים שלהם'
  it('detects visually ordered Hebrew', () => {
    const lines = Array.from({ length: 5 }, () => line(rev(logical), 0))
    expect(looksReversed([lines])).toBe(true)
  })
  it('leaves logically ordered Hebrew alone', () => {
    const lines = Array.from({ length: 5 }, () => line(logical, 0))
    expect(looksReversed([lines])).toBe(false)
  })
  it('ignores non-Hebrew text', () => {
    expect(looksReversed([[line('plain english text here', 0)]])).toBe(false)
  })
  it('needs more than a handful of samples', () => {
    expect(looksReversed([[line(rev('הילדים הלכו'), 0)]])).toBe(false)
  })
})

describe('fixVisual', () => {
  it('restores reversed Hebrew', () => {
    expect(fixVisual(rev('שלום עולם'))).toBe('שלום עולם')
  })
  it('mirrors brackets', () => {
    expect(fixVisual(rev('שלום (עולם)'))).toBe('שלום (עולם)')
  })
  it('keeps digit runs readable', () => {
    expect(fixVisual('123 םולש')).toBe('שלום 123')
  })
  it('keeps latin words readable', () => {
    expect(fixVisual('abc םולש')).toBe('שלום abc')
  })
  it('does not touch text without Hebrew', () => {
    expect(fixVisual('hello (world)')).toBe('hello (world)')
  })
})

describe('toParagraphs', () => {
  it('joins lines of one paragraph', () => {
    const ls = [line('first line', 100), line('second line', 88), line('third line', 76)]
    expect(toParagraphs(ls, false)).toEqual(['first line second line third line'])
  })
  it('splits on a large vertical gap', () => {
    const ls = [line('a', 100), line('b', 88), line('c', 76), line('d', 40)]
    expect(toParagraphs(ls, false)).toEqual(['a b c', 'd'])
  })
  it('splits after a short line that ends a sentence', () => {
    const ls = [line('long line', 100), line('end.', 88, { x1: 50 }), line('next', 76)]
    expect(toParagraphs(ls, false)).toEqual(['long line end.', 'next'])
  })
  it('drops bare page numbers at the top and bottom', () => {
    const ls = [line('12', 120), line('text', 100), line('more', 88), line('- 13 -', 60)]
    expect(toParagraphs(ls, false)).toEqual(['text more'])
  })
  it('re-joins words hyphenated across lines', () => {
    const ls = [line('inter-', 100), line('national', 88)]
    expect(toParagraphs(ls, false)).toEqual(['international'])
  })
  it('keeps a Hebrew maqaf at line end', () => {
    expect(toParagraphs([line('בית־', 100), line('ספר', 88)], false)).toEqual(['בית־ ספר'])
  })
  it('un-reverses lines when asked', () => {
    expect(toParagraphs([line(rev('שלום עולם'), 100)], true)).toEqual(['שלום עולם'])
  })
  it('returns nothing for an empty page', () => {
    expect(toParagraphs([], false)).toEqual([])
    expect(toParagraphs([line('7', 50)], false)).toEqual([])
  })
})

describe('detectHeadings', () => {
  const body = (y: number) => line('גוף הטקסט של העמוד הזה', y)
  it('finds big short lines near the top of a page', () => {
    const pages = [
      [line('פתיחה גדולה', 200, { h: 20 }), body(180), body(168)],
      [body(200), body(188), body(176)],
      [body(200), body(188), body(176)],
    ]
    expect([...detectHeadings(pages, false)]).toEqual([[0, 'פתיחה גדולה']])
  })
  it('recognizes named headings even at body size', () => {
    const pages = [[line('פרק ראשון', 200), body(188), body(176)], [body(200), body(188)]]
    expect(detectHeadings(pages, false).get(0)).toBe('פרק ראשון')
  })
  it('ignores a running header repeated on many pages', () => {
    const pages = Array.from({ length: 6 }, () => [line('כותרת עליונה', 200, { h: 20 }), body(180), body(168)])
    expect(detectHeadings(pages, false).size).toBe(0)
  })
  it('un-reverses headings in reversed documents', () => {
    const pages = [[line(rev('פרק ראשון'), 200), body(188)], [body(200), body(188)]]
    expect(detectHeadings(pages, true).get(0)).toBe('פרק ראשון')
  })
  it('gives up when nearly every page looks like a heading', () => {
    const pages = Array.from({ length: 60 }, (_, i) => [
      line(`כותרת ${i} שונה`, 200, { h: 20 }),
      body(180),
      body(168),
      body(156),
      body(144),
    ])
    expect(detectHeadings(pages, false).size).toBe(0)
  })
})
