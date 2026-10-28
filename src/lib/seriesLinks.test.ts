import { describe, expect, it } from 'vitest'
import { debutGaps, debutVerdict, designVerdict, houseOf, houseVerdict, jointVerdict, placeSeries, printDistance, printOf, type Placed } from './seriesLinks'

describe('houseOf', () => {
  it('reads the translator, the publisher and the ISBN block of a copyright page', () => {
    const page = ['תרגום מאנגלית: דנה לוי', '© כל הזכויות שמורות להוצאת כנרת', 'מסת"ב 978-965-07-1234-5']
    expect(houseOf(page).sort()).toEqual(['i:978-965-07', 'p:כנרת', 't:דנה לוי'])
  })
  it('takes the name on the next line when the credit stands alone, and English credits', () => {
    expect(houseOf(['תרגום:', 'דנה לוי'])).toEqual(['t:דנה לוי'])
    expect(houseOf(['Translated from the French by Anne Smith', 'Published by Orion Books']).sort()).toEqual(['p:orion', 't:anne smith'])
  })
  it('reads no block from an ISBN without its hyphens (its length is not fixed)', () => {
    expect(houseOf(['ISBN 9789650712345'])).toEqual([])
  })
})

describe('houseVerdict', () => {
  const library = [['p:כנרת'], ['p:עם'], ['p:מודן'], ['p:זמורה'], ['p:אחר'], ['p:עוד']]
  it('agrees when most of the series shares the translator', () => {
    expect(houseVerdict(['t:דנה לוי'], [['t:דנה לוי'], ['t:דנה לוי'], []], library)).toBe('agree')
  })
  it('needs two books for a publisher, and a publisher not of half the library', () => {
    expect(houseVerdict(['p:כנרת'], [['p:כנרת']], library)).toBeUndefined()
    expect(houseVerdict(['p:כנרת'], [['p:כנרת'], ['p:כנרת']], library)).toBe('agree')
    const common = [...library.map(() => ['p:כנרת']), ['p:עם']]
    expect(houseVerdict(['p:כנרת'], [['p:כנרת'], ['p:כנרת']], common)).toBeUndefined()
  })
  it('says nothing when the series is split, and never speaks against', () => {
    expect(houseVerdict(['t:דנה לוי'], [['t:דנה לוי'], ['t:אחר'], ['t:אחר']], library)).toBeUndefined()
    expect(houseVerdict(['t:אחר'], [['t:דנה לוי'], ['t:דנה לוי']], library)).toBeUndefined()
  })
})

describe('the cover print', () => {
  const grey = (f: (x: number, y: number) => number) => Array.from({ length: 72 }, (_, i) => f(i % 9, Math.floor(i / 9)))
  const rgb = (r: number, g: number, b: number) => Array.from({ length: 27 }, (_, i) => [r, g, b][i % 3]!)
  it('is 16 hex digits of shape and 27 colours', () => {
    expect(printOf(grey((x) => x), rgb(10, 20, 30))).toMatch(/^[0-9a-f]{16}\.[0-9a-f]{54}$/)
  })
  it('is near for one design and far for another', () => {
    const a = printOf(grey((x) => x * 10), rgb(200, 30, 30))
    const b = printOf(grey((x) => x * 10 + 1), rgb(190, 40, 30))
    const c = printOf(grey((x) => 90 - x * 10), rgb(20, 200, 220))
    expect(printDistance(a, b)).toBeLessThan(0.1)
    expect(printDistance(a, c)).toBeGreaterThan(1)
    expect(printDistance(a, 'junk')).toBe(2)
  })
  it('agrees when the series covers are nearer than nearly all the rest', () => {
    const series = (k: number) => printOf(grey((x) => x * 10 + k), rgb(200, 30 + k, 30))
    const other = (k: number) => printOf(grey((x, y) => ((x * 7 + y * 13 + k * 5) % 11) * 20), rgb((k * 40) % 255, (k * 90) % 255, (k * 20) % 255))
    const others = Array.from({ length: 10 }, (_, k) => other(k + 1))
    expect(designVerdict(series(0), [series(2), series(4)], others)).toBe('agree')
    expect(designVerdict(other(20), [series(2), series(4)], others)).toBeUndefined()
    // too few covers to know what near is
    expect(designVerdict(series(0), [series(2), series(4)], others.slice(0, 3))).toBeUndefined()
  })
})

describe('the debut', () => {
  it('counts the books a word skips in its run', () => {
    expect(debutGaps([['a'], ['a'], ['a']])).toBe(0)
    expect(debutGaps([['a'], [], ['a']])).toBe(1)
    expect(debutGaps([['a'], ['b'], ['c']])).toBe(0)
  })
  // book 1 brings in פרסי, 2 brings in תייסון, 3 brings in ביאנקה, 4 brings in ניקו
  const words = { 1: ['פרסי', 'אנבת'], 2: ['פרסי', 'אנבת', 'תייסון'], 3: ['פרסי', 'אנבת', 'תייסון', 'ביאנקה'], 4: ['פרסי', 'אנבת', 'תייסון', 'ביאנקה', 'ניקו'] }
  it('agrees with the place where its words skip no book', () => {
    const members = [1, 2, 4].map((n) => ({ number: n, words: words[n as 1 | 2 | 4] }))
    expect(debutVerdict(members, words[3], 3)).toBe('agree')
    expect(debutVerdict(members, words[3], 1)).toBeUndefined()
  })
  it('needs three books with their words', () => {
    expect(debutVerdict([1, 2].map((n) => ({ number: n, words: words[n as 1 | 2] })), words[3], 3)).toBeUndefined()
  })
})

describe('placeSeries', () => {
  const years = new Map([
    [1, 2005],
    [2, 2006],
    [3, 2007],
  ])
  it('places every book together: a year the catalog gives, and the book each place is left for', () => {
    const books: Placed[] = [
      { id: 'a', number: 1, anchored: true, year: 2005 },
      { id: 'x', year: 2007 },
      { id: 'me', year: 2006 },
    ]
    expect(placeSeries(books, 'me', { total: 3, years })).toMatchObject({ number: 2 })
    expect(jointVerdict(books, 'me', 2, { total: 3, years })).toBe('agree')
    expect(jointVerdict(books, 'me', 3, { total: 3, years })).toBe('against')
  })
  it('moves a number the identification gave when the clues of the whole series say otherwise', () => {
    // x was given 2 by its name (not by the user), but its own pages and the list say 3, and this book says 2
    const books: Placed[] = [{ id: 'a', number: 1, anchored: true }, { id: 'x', number: 2, own: 3, listed: 3 }, { id: 'me', own: 2 }]
    expect(placeSeries(books, 'me', { total: 3 })).toMatchObject({ number: 2 })
  })
  it('never moves a book the user named, and says nothing with no clue', () => {
    const books: Placed[] = [{ id: 'a', number: 2, anchored: true }, { id: 'me', own: 2 }]
    expect(placeSeries(books, 'me', { total: 3 })?.number).not.toBe(2)
    expect(jointVerdict([{ id: 'a', number: 1, anchored: true }, { id: 'me' }], 'me', 2, { total: 3 })).toBeUndefined()
  })
})
