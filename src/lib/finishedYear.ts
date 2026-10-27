import { isFinished, type BookMeta } from './db'
import type { Stats } from './stats'

/** when a finished book was finished: its stamp, else (finished before the date was kept) the last time it was opened */
export const finishedDate = (b: BookMeta): number | undefined =>
  isFinished(b) ? (b.finishedAt ?? b.lastOpened ?? b.addedAt) : undefined

interface FinishedEntry {
  book: BookMeta
  at: number
  /** active reading seconds spent on it */
  secs: number
}

interface FinishedYear {
  year: number
  /** months that have finished books, newest first; month is 0–11 */
  months: { month: number; books: FinishedEntry[] }[]
  count: number
  secs: number
  words: number
  /** average rating of the rated books, 0 when none is rated */
  avgRating: number
}

/** years that have a finished book, newest first */
export function finishedYears(books: BookMeta[]): number[] {
  const years = new Set<number>()
  for (const b of books) {
    const at = finishedDate(b)
    if (at) years.add(new Date(at).getFullYear())
  }
  return [...years].sort((a, b) => b - a)
}

/** the books finished in `year`, by month, with the totals the summary shows */
export function finishedInYear(books: BookMeta[], stats: Map<string, Stats>, year: number): FinishedYear {
  const entries: FinishedEntry[] = []
  for (const b of books) {
    const at = finishedDate(b)
    if (!at || new Date(at).getFullYear() !== year) continue
    entries.push({ book: b, at, secs: stats.get(b.id)?.secs ?? 0 })
  }
  entries.sort((a, b) => b.at - a.at)
  const months: FinishedYear['months'] = []
  for (const e of entries) {
    const month = new Date(e.at).getMonth()
    const last = months[months.length - 1]
    if (last?.month === month) last.books.push(e)
    else months.push({ month, books: [e] })
  }
  const rated = entries.filter((e) => e.book.rating)
  return {
    year,
    months,
    count: entries.length,
    secs: entries.reduce((s, e) => s + e.secs, 0),
    words: entries.reduce((s, e) => s + (e.book.words ?? 0), 0),
    avgRating: rated.length ? rated.reduce((s, e) => s + e.book.rating!, 0) / rated.length : 0,
  }
}

/** "loved most" order: by rating, highest first; unrated books after the rated ones */
export const byRating = (a: Pick<BookMeta, 'rating'>, b: Pick<BookMeta, 'rating'>) => (b.rating ?? 0) - (a.rating ?? 0)
