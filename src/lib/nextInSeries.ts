import { splitBookName } from './bookName'
import { bookNumber } from './bookInference'
import type { BookMeta } from './db'

/** a series name compared without nikud, accents, punctuation, case or extra spaces */
const seriesKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('he')

/** the book's place as a number: "3", "2 העידן הראשון" (the first word), "IV"; undefined when it is not one */
export function placeNumber(number: string): number | undefined {
  const head = number.trim().split(/\s+/)[0] ?? ''
  if (/^\d{1,3}$/.test(head)) return Number(head)
  return bookNumber(head)
}

export interface SeriesPlace {
  series: string
  number: number
  /** the series' book with the lowest number after this one that is in the library */
  next?: BookMeta
  nextNumber?: number
}

/**
 * Where a book sits in its series, by the library's naming template ("series number - title"), and the book in the
 * library that comes after it. Undefined for a book outside a series or without a number. When several books have
 * the next number (copies), the one opened most recently wins.
 */
export function nextInSeries(cur: Pick<BookMeta, 'id' | 'title'>, books: BookMeta[]): SeriesPlace | undefined {
  const own = splitBookName(cur.title)
  if (!own.series) return undefined
  const number = placeNumber(own.number)
  if (number === undefined) return undefined
  const key = seriesKey(own.series)
  let best: { b: BookMeta; n: number } | undefined
  for (const b of books) {
    if (b.id === cur.id) continue
    const p = splitBookName(b.title)
    if (!p.series || seriesKey(p.series) !== key) continue
    const n = placeNumber(p.number)
    if (n === undefined || n <= number) continue
    if (!best || n < best.n || (n === best.n && (b.lastOpened ?? 0) > (best.b.lastOpened ?? 0))) best = { b, n }
  }
  return { series: own.series, number, next: best?.b, nextNumber: best?.n }
}
