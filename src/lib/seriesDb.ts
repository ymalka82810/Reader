// The series that come with the app: every book Wikidata has in a series (P179, with its number P1545) whose name, and
// its series' name, are in Hebrew, built from Wikidata by scripts/build-series-db.mjs and shipped as
// public/series-he.json (refreshed by the series-db workflow). A book of one of them is identified offline, with no
// consent asked, by its title (inLists, as Wikidata's lists the device learned), and a translated book's original
// series on its copyright page ("MAGISTERIUM V") is found by its sound even when the library has none of its books.
import { authorKey } from './authorName'
import type { SeriesList } from './bookInference'
import { norm } from './sameBook'

/** a series as the file keeps it: its name, its author, and its books as [number, title] */
export interface SeriesEntry {
  s: string
  a?: string
  b: [string, string][]
}

type Bundled = SeriesList & { author?: string; from: 'wikidata'; key: string }

let lists: Bundled[] = []
let loading: Promise<void> | undefined

/** the series' file, read once for as long as the app runs (not in the tests, which set it themselves) */
export function loadSeriesDb(): Promise<void> {
  if (import.meta.env.MODE === 'test' || typeof document === 'undefined') return Promise.resolve()
  loading ??= fetch(new URL(`${import.meta.env.BASE_URL}series-he.json`, document.baseURI))
    .then((r) => (r.ok ? (r.json() as Promise<unknown>) : []))
    .then((data) => setSeriesDb(Array.isArray(data) ? (data as SeriesEntry[]) : []))
    .catch((e: unknown) => {
      console.warn('series-he.json', e)
      loading = undefined
    })
  return loading
}

export function setSeriesDb(data: SeriesEntry[]) {
  lists = data
    .filter((e) => e && typeof e.s === 'string' && Array.isArray(e.b) && e.b.length)
    .map((e) => ({
      series: e.s,
      books: e.b.map(([number, title]) => ({ number: String(number), title })),
      ...(e.a && { author: e.a }),
      from: 'wikidata' as const,
      key: e.a ? authorKey(e.a) : '',
    }))
}

/**
 * The series of the file that may hold a book by `author` (any, with no author). With no author, a title of one word
 * ("הבחירה") is too common to look up among thousands of series: `title` given, only a title of two words or more.
 */
export function bundledLists(author: string, title?: string): (SeriesList & { author?: string; from: 'wikidata' })[] {
  if (!lists.length) return []
  if (!norm(author)) return title !== undefined && norm(title).split(' ').length < 2 ? [] : lists
  const key = authorKey(author)
  const a = norm(author)
  return lists.filter((l) => !l.author || norm(l.author) === a || (!!key && l.key === key))
}

/** the file's series as the original series on a copyright page is matched against (librarySeriesFor) */
export function bundledSeries(): { name: string; authors: Set<string> }[] {
  return lists.map((l) => ({ name: l.series, authors: new Set(l.author ? [norm(l.author)] : []) }))
}

/** the title of the book in this place of a series of the file */
export function bundledTitle(series: string, number: string): string | undefined {
  const titles = new Set(lists.filter((l) => norm(l.series) === norm(series)).flatMap((l) => l.books.filter((b) => Number(b.number) === Number(number)).map((b) => b.title)))
  return titles.size === 1 ? [...titles][0] : undefined
}

export const seriesDbSize = () => ({ series: lists.length, books: lists.reduce((n, l) => n + l.books.length, 0) })
