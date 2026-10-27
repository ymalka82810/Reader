import { describe, expect, it } from 'vitest'
import type { BookMeta } from './db'
import { byRating, finishedInYear, finishedYears } from './finishedYear'

const at = (y: number, m: number, d = 10) => new Date(y, m, d).getTime()
const book = (id: string, extra: Partial<BookMeta>): BookMeta =>
  ({ id, title: id, author: '', kind: 'epub', fileName: `${id}.epub`, addedAt: at(2020, 0), ...extra }) as BookMeta

describe('finished this year', () => {
  const books = [
    book('a', { finished: true, finishedAt: at(2026, 2), rating: 5, words: 1000 }),
    book('b', { finished: true, finishedAt: at(2026, 2, 20), rating: 3, words: 500 }),
    book('c', { finished: true, finishedAt: at(2026, 7) }),
    book('d', { finished: true, finishedAt: at(2025, 11) }),
    book('e', { fraction: 0.4 }), // still reading
    book('f', { fraction: 1, lastOpened: at(2026, 5) }), // read before the date was kept: last opened stands in
    book('g', { fraction: 1, read: [[0, 0.05]], lastOpened: at(2026, 5) }), // only dragged to the end
  ]
  const stats = new Map([
    ['a', { secs: 3600, frac: 1 }],
    ['c', { secs: 1800, frac: 1 }],
  ])

  it('groups the year by month, newest first, with the totals', () => {
    const y = finishedInYear(books, stats, 2026)
    expect(y.months.map((m) => [m.month, m.books.map((e) => e.book.id)])).toEqual([
      [7, ['c']],
      [5, ['f']],
      [2, ['b', 'a']],
    ])
    expect(y.count).toBe(4)
    expect(y.secs).toBe(5400)
    expect(y.words).toBe(1500)
    expect(y.avgRating).toBe(4)
  })

  it('lists the years that have finished books', () => {
    expect(finishedYears(books)).toEqual([2026, 2025])
  })

  it('"loved most" puts the highest rated first and the unrated last', () => {
    expect([{ rating: 3 }, {}, { rating: 5 }].sort(byRating)).toEqual([{ rating: 5 }, { rating: 3 }, {}])
  })
})
