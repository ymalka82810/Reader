import { describe, expect, it } from 'vitest'
import { buildLines, looksTabular, normalizeStreamOrder, readingGroups, type Line, type RawItem } from './pdfLayout'
import { detectHeadings, fixVisual, isBlankPixels, isPoorPage, joinPages, looksReversed, stripRunningLines, toParagraphs } from './pdfText'

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

describe('stripRunningLines', () => {
  const page = (n: number): Line[] => [
    line('שם הספר', 200),
    line(`גוף העמוד ${'ד'.repeat(n)} עם טקסט`, 180),
    line(`שורה אחת של טקסט ${'א'.repeat(n)}`, 168),
    line(`שורה שנייה של טקסט ${'ב'.repeat(n)}`, 156),
    line(`שורה שלישית של טקסט ${'ג'.repeat(n)}`, 144),
    line(`- ${n} -`, 20),
  ]
  it('removes repeated headers and numbered footers', () => {
    const out = stripRunningLines(Array.from({ length: 6 }, (_, i) => page(i + 1)))
    for (const lines of out) {
      expect(lines).toHaveLength(4)
      expect(lines[0]!.text).toMatch(/^גוף העמוד/)
    }
  })
  it('keeps a heading that appears only once', () => {
    const pages = Array.from({ length: 6 }, (_, i) => page(i + 1))
    pages[2] = [line('פרק שלישי', 200), ...pages[2]!.slice(1)]
    expect(stripRunningLines(pages)[2]![0]!.text).toBe('פרק שלישי')
  })
  it('leaves very short documents alone', () => {
    const pages = [page(1), page(2)]
    expect(stripRunningLines(pages)).toBe(pages)
  })
})

describe('joinPages', () => {
  it('merges a paragraph that continues on the next page', () => {
    expect(joinPages([['intro.', 'the sentence goes'], ['on here.', 'next']])).toEqual([
      'intro.',
      'the sentence goes on here.',
      'next',
    ])
  })
  it('does not merge after a finished sentence', () => {
    expect(joinPages([['done.'], ['new']])).toEqual(['done.', 'new'])
  })
  it('re-joins a word hyphenated across the page break', () => {
    expect(joinPages([['inter-'], ['national law.']])).toEqual(['international law.'])
  })
})

describe('readingGroups', () => {
  const item = (str: string, x: number, y: number, w = 100): RawItem => ({ str, x, y, w, h: 10, eol: true })
  const column = (x: number, tag: string) => Array.from({ length: 8 }, (_, i) => item(`${tag}${i}`, x, 300 - i * 12))
  it('keeps a single column as one group', () => {
    const items = Array.from({ length: 20 }, (_, i) => item(`l${i}`, 0, 300 - i * 12, 400))
    expect(readingGroups(items)).toHaveLength(1)
  })
  it('reads left column before right, even when the stream interleaves them', () => {
    const l = column(0, 'L')
    const r = column(200, 'R')
    const interleaved = l.flatMap((a, i) => [a, r[i]!])
    const groups = readingGroups(interleaved).map((g) => g.map((i) => i.str[0]))
    expect(groups).toHaveLength(2)
    expect(groups[0]!.every((c) => c === 'L')).toBe(true)
    expect(groups[1]!.every((c) => c === 'R')).toBe(true)
  })
  it('reads the right column first for Hebrew', () => {
    const l = Array.from({ length: 8 }, (_, i) => item(`שמאל${i}`, 0, 300 - i * 12))
    const r = Array.from({ length: 8 }, (_, i) => item(`ימין${i}`, 200, 300 - i * 12))
    const groups = readingGroups([...l, ...r])
    expect(groups[0]![0]!.str).toBe('ימין0')
  })
  it('keeps a full-width title above the columns', () => {
    const title = item('Title', 0, 330, 300)
    const groups = readingGroups([...column(200, 'R'), title, ...column(0, 'L')])
    expect(groups.map((g) => g[0]!.str[0])).toEqual(['T', 'L', 'R'])
  })
})

describe('isPoorPage', () => {
  const para = (n: number) =>
    Array.from({ length: n }, (_, i) => line('הילדים הלכו לבית הספר ביחד עם החברים', 800 - i * 12))
  it('accepts an ordinary page of prose', () => {
    expect(isPoorPage(para(20))).toBe(false)
  })
  it('ignores empty and near-empty pages', () => {
    expect(isPoorPage([])).toBe(false)
    expect(isPoorPage([line('12', 50)])).toBe(false)
  })
  it('flags broken glyph mappings', () => {
    expect(isPoorPage([...para(5), line('��� ��', 100)])).toBe(true)
  })
  it('flags number-heavy pages such as tables', () => {
    const rows = Array.from({ length: 15 }, (_, i) => line('12.5  30.1  44.8  1,200  99.9 ' + i, 800 - i * 12))
    expect(isPoorPage(rows)).toBe(true)
  })
  it('flags text shattered into fragments', () => {
    const frags = Array.from({ length: 30 }, (_, i) => line('אבג ' + i, 800 - i * 12))
    expect(isPoorPage(frags)).toBe(true)
  })
})

describe('looksTabular', () => {
  const run = (str: string, x: number, y: number, w = 30): RawItem => ({ str, x, y, w, h: 10, eol: false })
  const table = (rows: number) =>
    Array.from({ length: rows }, (_, r) => [run('name', 50, 700 - r * 14), run('qty', 200, 700 - r * 14), run('price', 350, 700 - r * 14)]).flat()

  it('detects aligned rows of separate cells', () => {
    expect(looksTabular(table(6))).toBe(true)
  })
  it('detects a table whose cells are right-aligned', () => {
    const items = Array.from({ length: 6 }, (_, r) => [
      run('a', 50, 700 - r * 14, 20 + r),
      run('b', 250 - r, 700 - r * 14, 20 + r),
      run('c', 400 - r * 2, 700 - r * 14, 20 + r),
    ]).flat()
    expect(looksTabular(items)).toBe(true)
  })
  it('ignores ordinary paragraphs and two-column text', () => {
    const text = Array.from({ length: 20 }, (_, r) => run('a full line of running text', 50, 700 - r * 14, 400))
    expect(looksTabular(text)).toBe(false)
    const cols = Array.from({ length: 12 }, (_, r) => [run('left column line', 50, 700 - r * 14, 200), run('right column line', 300, 700 - r * 14, 200)]).flat()
    expect(looksTabular(cols)).toBe(false)
  })
  it('needs several rows', () => {
    expect(looksTabular(table(3))).toBe(false)
  })
})

describe('isBlankPixels', () => {
  const px = (...rgba: number[]) => Uint8ClampedArray.from(rgba)
  it('is true for white and near-white pixels', () => {
    expect(isBlankPixels(px(255, 255, 255, 255, 250, 252, 249, 255))).toBe(true)
  })
  it('is true when nothing is drawn (transparent)', () => {
    expect(isBlankPixels(px(0, 0, 0, 0))).toBe(true)
  })
  it('is false once any pixel has ink', () => {
    expect(isBlankPixels(px(255, 255, 255, 255, 200, 255, 255, 255))).toBe(false)
  })
})

describe('normalizeStreamOrder', () => {
  const run = (str: string, x: number, y: number, eol = false): RawItem => ({ str, x, y, w: 40, h: 10, eol })
  // a Hebrew page of 12 lines x 4 words, words laid out right to left, in reading order
  const reading = Array.from({ length: 12 }, (_, l) =>
    Array.from({ length: 4 }, (_, w) => run(`מילה${l}${w}`, 300 - w * 50, 300 - l * 14, w === 3)),
  ).flat()
  const text = (items: RawItem[]) => buildLines(items).map((l) => l.text)

  it('leaves a page stored in reading order alone', () => {
    expect(normalizeStreamOrder(reading)).toBe(reading)
  })
  it('puts a page stored back to front into reading order', () => {
    const backwards = [...reading].reverse()
    expect(text(normalizeStreamOrder(backwards))).toEqual(text(reading))
    expect(text(normalizeStreamOrder(backwards))[0]).toBe('מילה00מילה01מילה02מילה03')
  })
  it('does not touch a page with too few lines to tell', () => {
    const few = [run('א', 0, 100), run('ב', 0, 120), run('ג', 0, 140)]
    expect(normalizeStreamOrder(few)).toBe(few)
  })
})
