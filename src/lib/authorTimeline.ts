// The author's timeline: a link from the author's side rather than the series'. The years the author's books came out (in
// the library, and in the catalogs' lists of the author's series) are the years the author was writing, and which series
// the author was writing when. A book whose year is well before the author's first, or a series placed in years the author
// was writing another series altogether, gets a weak clue against (`timeline`, which does not block until the user's
// answers show it right). And the other way: a book with no author whose year, publisher and translator fit the books of
// one author of the library, and of no other, is offered that author. All of it runs on the device.

/** one of the author's books with its year: `series` is the series it is in ('' for none), as the caller names it */
export interface Dated {
  year: number
  series: string
}

/** years before the author's first book, or around a series' own years, that are still taken as the author's */
const SLACK = 3

/**
 * The timeline's say on a book of this author from `year` (in `series`, '' for none), by the author's other books
 * (`works`, not this one): against when it is from well before the first of three dated books at least, or when its
 * series' own books (two at least) are years away from it and another series of the author's (two books at least) was
 * being written that very year. Silent otherwise: the author's next book is always after the last.
 */
export function timelineVerdict(works: Dated[], year: number, series = ''): 'against' | undefined {
  if (works.length >= 3 && year < Math.min(...works.map((w) => w.year)) - SLACK) return 'against'
  if (!series) return undefined
  const span = (ws: Dated[]) => [Math.min(...ws.map((w) => w.year)), Math.max(...ws.map((w) => w.year))] as const
  const own = works.filter((w) => w.series === series)
  if (own.length < 2) return undefined
  const [from, to] = span(own)
  if (year >= from - SLACK && year <= to + SLACK) return undefined
  const others = new Map<string, Dated[]>()
  for (const w of works) if (w.series && w.series !== series) others.set(w.series, [...(others.get(w.series) ?? []), w])
  for (const ws of others.values()) {
    if (ws.length < 2) continue
    const [a, b] = span(ws)
    if (year >= a && year <= b) return 'against'
  }
  return undefined
}

/** what is known of one of the library's books for the timeline: its year and who made its edition (seriesLinks' houseOf) */
export interface Work {
  year?: number
  house: string[]
}

/**
 * The author a book with none fits: the one author of the library (two dated or credited books at least) who shares its
 * translator, and its publisher when it names one, and whose years it falls within (or near, by SLACK) when it has one.
 * Undefined when none fits, or when more than one does (a translator of several authors says nothing then).
 */
export function authorByTimeline(year: number | undefined, house: string[], authors: { author: string; works: Work[] }[]): string | undefined {
  const translators = house.filter((k) => k.startsWith('t:'))
  if (!translators.length) return undefined
  const publishers = house.filter((k) => k.startsWith('p:'))
  const fits = authors.filter(({ works }) => {
    if (works.length < 2) return false
    const theirs = new Set(works.flatMap((w) => w.house))
    if (!translators.some((k) => theirs.has(k))) return false
    if (publishers.length && !publishers.some((k) => theirs.has(k))) return false
    const years = works.map((w) => w.year).filter((y): y is number => !!y)
    if (year && years.length && (year < Math.min(...years) - SLACK || year > Math.max(...years) + SLACK)) return false
    return true
  })
  return fits.length === 1 ? fits[0]!.author : undefined
}
