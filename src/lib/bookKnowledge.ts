// What the identification knows of the world's books, kept on the device: the series' lists of books, each title with
// its number. They come from the lists books print ("ספרים נוספים בסדרה"), from the whole list of a series Wikidata
// gives once it named one of its books, from a series a catalog gave a book, and from every name saved in the library.
// A book of a series known so is identified from it at once, offline, by its title (inLists), and the knowledge stays
// when the books that taught it are gone.

import type { SeriesList } from './bookInference'
import { guessBookName, tidyBookName } from './bookName'
import { norm } from './sameBook'

const LISTS_KEY = 'reader:series-lists'
const LISTS_MAX = 500
/** `from`: where a list came from — printed in a book (none), Wikidata's whole series, the names saved in the library, or
 *  the next or previous book a book of the series names (sequels) */
type From = 'wikidata' | 'library' | 'sequel'
type KeptList = SeriesList & { author?: string; from?: From }

export function keptLists(): KeptList[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LISTS_KEY) ?? '[]')
    return Array.isArray(v) ? (v as KeptList[]) : []
  } catch {
    return []
  }
}

function keep(lists: KeptList[]) {
  try {
    localStorage.setItem(LISTS_KEY, JSON.stringify(lists.slice(-LISTS_MAX)))
  } catch {
    /* storage unavailable */
  }
}

const sameAuthor = (x = '', y = '') => {
  const a = norm(x)
  const b = norm(y)
  return !a || !b || a === b || a.includes(b) || b.includes(a)
}

/** keeps lists of a series' books, each once, with the author they were read with */
export function rememberLists(lists: SeriesList[], author = '', from?: From) {
  const key = (l: SeriesList) => `${norm(l.series)}|${l.books.map((b) => `${b.number}:${norm(b.title)}`).join(',')}`
  const kept = keptLists()
  const have = new Set(kept.map(key))
  const added = lists.filter((l) => l.books.length && !have.has(key(l))).map((l) => ({ ...l, ...(author.trim() && { author: author.trim() }), ...(from && { from }) }))
  if (added.length) keep([...kept, ...added])
}

/**
 * Keeps one book of a named series: it joins the list kept for that series and author (taking the place of an entry
 * with the same title or number there), or starts one. The newest list goes last, so it is the last to be dropped.
 */
export function rememberWork(series: string, number: string, title: string, author = '') {
  const n = String(Number(number) || '')
  if (!norm(series) || !n || !norm(title)) return
  const kept = keptLists()
  const mine = (l: KeptList) => l.from === 'library' && norm(l.series) === norm(series) && sameAuthor(l.author, author)
  if (kept.some((l) => mine(l) && l.books.some((b) => norm(b.title) === norm(title) && b.number === n))) return
  const at = kept.findIndex(mine)
  const list: KeptList =
    at >= 0
      ? kept.splice(at, 1)[0]!
      : { series: series.trim(), books: [], from: 'library', ...(author.trim() && { author: author.trim() }) }
  list.books = [...list.books.filter((b) => norm(b.title) !== norm(title) && b.number !== n), { title: title.trim(), number: n }].sort(
    (x, y) => Number(x.number) - Number(y.number),
  )
  if (!list.author && author.trim()) list.author = author.trim()
  keep([...kept, list])
}

/** keeps a name saved in the library, when it is a series' book with a number and a title of its own */
export function rememberName(name: string, author = '') {
  const g = guessBookName(tidyBookName(name))
  if (g.series && g.number && g.title) rememberWork(g.series, g.number, g.title, author)
}

/** the kept lists that may be this author's: those of the same author, or of none known; only those from `from` when
 *  given (undefined in it stands for the lists printed in books) */
export function listsOf(author: string, from?: (From | undefined)[]): KeptList[] {
  return keptLists().filter((l) => sameAuthor(l.author, author) && (!from || from.includes(l.from)))
}

/** A book of a series, named in the library, names the next book of it (in its last pages) or the one before (in its
 *  opening): they are kept as that series' books, one number after and one before. */
export function rememberSequels(name: string, author = '', next: string[] = [], prev: string[] = []) {
  const g = guessBookName(tidyBookName(name))
  const n = Number(g.number)
  if (!g.series || !n) return
  const books = [
    ...next.map((title) => ({ title, number: String(n + 1) })),
    ...(n > 1 ? prev.map((title) => ({ title, number: String(n - 1) })) : []),
  ].filter((b) => norm(b.title) && norm(b.title) !== norm(g.title))
  if (books.length) rememberLists([{ series: g.series, books }], author, 'sequel')
}

/** how much is known: the lists kept from each source, and the books in them */
export function knowledgeReport(): { lists: Record<'book' | From, number>; books: number } {
  const lists = { book: 0, wikidata: 0, library: 0, sequel: 0 }
  let books = 0
  for (const l of keptLists()) {
    lists[l.from ?? 'book']++
    books += l.books.length
  }
  return { lists, books }
}
