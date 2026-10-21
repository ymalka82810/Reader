// Identifying a book: its series, number, full title and author, read first from what the library has (the title and the
// file name it was added under), the EPUB's own package and the opening pages, and then completed from the catalogs online,
// none of which needs a key: Google Books first, by the book's ISBN, which names the edition exactly, then by its title;
// Open Library the same way when Google Books found nothing or did not answer; and Wikidata for the series and its number
// when the name still has no series. Only the ISBN, the title and the author are sent, and only after the user agreed
// (consent 'books').

import { authorInName, guessBookName, isJunkTitle, nameFromOpening, seriesOf, tidyBookName, withoutAuthor, type BookName } from './bookName'
import type { EpubMeta } from './bookText'
import { bookIsbns } from './isbn'
import { norm } from './sameBook'

export interface Identified extends BookName {
  author: string
  /** whether a catalog online found the book; otherwise the result is what the library's own names gave */
  online: boolean
  /** the catalogs that gave what was found ("Google Books", "Open Library", "Wikidata") */
  sites?: string[]
  /** whether the name was read from the book's opening pages rather than from its title or file name */
  fromText?: boolean
  /** whether the series (or the title) came from the EPUB's package rather than from the book's names */
  fromMeta?: boolean
  /** Google Books was to be asked but did not answer (offline, or too many requests): what was read from the book's own
   *  names stands, and it is worth asking again later */
  failed?: boolean
  /** why: 'quota' when Google Books refused for too many requests (403/429), 'network' when it could not be reached */
  why?: 'quota' | 'network'
  /** whether the name can be saved without asking: the book was found by its ISBN, or Google Books has it under the
   *  same title and author, or the series came from the EPUB's package */
  sure?: boolean
}

type VolumeInfo = {
  title?: string
  subtitle?: string
  authors?: string[]
  language?: string
  seriesInfo?: { bookDisplayNumber?: string }
}

const hebrew = (s: string) => /[֐-׿]/.test(s)
const stem = (fileName: string) => fileName.replace(/\.[^.]+$/, '')

/** What the library's own names say: the title, and when that holds no series, the file name it was added under. */
export function identifyLocally(b: { title: string; author: string; fileName: string }): BookName {
  // the author's name is taken off both sides of the cleaning: before it, where a dash sets it apart, and after it, where
  // underscores ran it on to the end ("קלע_הכשף_#5_קוטל_המלכה_סבסטיאן_דה_קסטל")
  const tidy = (name: string) => guessBookName(withoutAuthor(tidyBookName(withoutAuthor(name, b.author)), b.author))
  const fromTitle = tidy(b.title)
  if (fromTitle.series) return fromTitle
  const fromFile = tidy(stem(b.fileName))
  // the file name names the same book: its title is the book's title, or holds it ("גנב הברק" in "גנב הברק מהדורה 2")
  if (fromFile.series && norm(fromFile.title).includes(norm(fromTitle.title))) return fromFile
  return fromTitle
}

/** a catalog entry as a name: its series from the title or the subtitle */
function nameOf(v: VolumeInfo): BookName {
  const title = v.title ?? ''
  const own = guessBookName(title)
  if (own.series) return own
  const sub = v.subtitle ? seriesOf(v.subtitle) : undefined
  if (sub) return { ...sub, title }
  if (v.subtitle) {
    // "פרסי ג'קסון והאולימפיים" (subtitle) + "גנב הברק" (title) with the number only in seriesInfo
    const n = v.seriesInfo?.bookDisplayNumber
    if (n && /^\d{1,3}$/.test(n)) return { series: v.subtitle.trim(), number: n, title }
  }
  return own
}

/** how well a catalog entry fits the book; 0 is not the same book */
function score(v: VolumeInfo, name: BookName, want: { title: string; author: string }): number {
  const t = norm(name.title)
  const w = norm(want.title)
  if (!t || !w) return 0
  let s = t === w ? 4 : t.includes(w) || w.includes(t) ? 2 : 0
  if (!s) return 0
  const a = norm(want.author)
  const theirs = (v.authors ?? []).map(norm)
  if (a && theirs.some((x) => x === a || x.includes(a) || a.includes(x))) s += 3
  if (hebrew(want.title) === hebrew(v.title ?? '')) s += 1
  if (name.series) s += 1
  return s
}

const API = 'https://www.googleapis.com/books/v1/volumes'
const OPEN_LIBRARY = 'https://openlibrary.org'
const WIKIDATA = 'https://query.wikidata.org/sparql'

/** the catalogs asked, and the names they are shown by */
type Source = 'google' | 'openlibrary' | 'wikidata'
const SITE: Record<Source, string> = { google: 'Google Books', openlibrary: 'Open Library', wikidata: 'Wikidata' }

/** How many requests one book may still make: a whole library must stay under Google Books' limit on requests. */
type Budget = { left: number }
const PER_BOOK = 6
/** Open Library is asked only when Google Books had nothing, and asks fewer questions: it is slower and its coverage of
 *  Hebrew books thinner */
const OPEN_LIBRARY_PER_BOOK = 3

/** Google Books refused or could not be reached; `why` says which */
class BooksUnavailable extends Error {
  why: 'quota' | 'network'
  constructor(why: 'quota' | 'network', message: string) {
    super(message)
    this.name = 'BooksUnavailable'
    this.why = why
  }
}

// Answers already given, kept on the device: the library is identified again after an update, and asking Google Books
// the same questions again would use up its daily quota. The most recent ones are kept.
const CACHE_KEY = 'reader:books-cache'
const CACHE_MAX = 1500
let cache: Map<string, VolumeInfo[]> | undefined
const cached = () => {
  if (!cache) {
    try {
      cache = new Map(Object.entries(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, VolumeInfo[]>))
    } catch {
      cache = new Map()
    }
  }
  return cache
}
/** forgets the answers kept (for tests, and when the device's storage is cleared) */
export function clearBooksCache() {
  cache = undefined
}

function remember(q: string, items: VolumeInfo[]) {
  const c = cached()
  c.delete(q)
  c.set(q, items.slice(0, 8))
  while (c.size > CACHE_MAX) c.delete(c.keys().next().value!)
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(c)))
  } catch {
    /* storage full or unavailable: the answers are kept for this session only */
  }
}

// after a refusal for too many requests, a catalog is not asked again for a while, from anywhere in the app
const BLOCK_KEY = 'reader:books-blocked-until'
const BLOCK_MS = 60 * 60 * 1000
const blockKey = (source: Source) => (source === 'google' ? BLOCK_KEY : `${BLOCK_KEY}:${source}`)
const blockedUntil = (source: Source) => Number(globalThis.localStorage?.getItem(blockKey(source)) ?? 0) || 0

/** one question to a catalog: answered from the device when it was asked before, and counted against the book's budget */
async function ask(
  source: Source,
  q: string,
  url: string,
  parse: (data: unknown) => VolumeInfo[],
  signal?: AbortSignal,
  budget?: Budget,
): Promise<VolumeInfo[]> {
  // Google Books' answers keep the keys they had before the other catalogs were added
  const key = source === 'google' ? q : `${source}:${q}`
  const known = cached().get(key)
  if (known) return known
  if (Date.now() < blockedUntil(source)) throw new BooksUnavailable('quota', `${SITE[source]} refused recently`)
  if (budget) {
    if (budget.left <= 0) return []
    budget.left--
  }
  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new BooksUnavailable('network', e instanceof Error ? e.message : String(e))
  }
  if (res?.status === 429 || res?.status === 403) {
    try {
      localStorage.setItem(blockKey(source), String(Date.now() + BLOCK_MS))
    } catch {
      /* storage unavailable */
    }
    throw new BooksUnavailable('quota', `${SITE[source]} answered ${res.status}`)
  }
  if (!res?.ok) throw new BooksUnavailable('network', `${SITE[source]} answered ${res?.status}`)
  let items: VolumeInfo[]
  try {
    items = parse(await res.json())
  } catch (e) {
    throw new BooksUnavailable('network', `${SITE[source]} sent an answer that could not be read: ${e instanceof Error ? e.message : String(e)}`)
  }
  remember(key, items)
  return items
}

function search(q: string, signal?: AbortSignal, budget?: Budget): Promise<VolumeInfo[]> {
  const params = new URLSearchParams({
    q,
    maxResults: '20',
    printType: 'books',
    fields: 'items(volumeInfo(title,subtitle,authors,language,seriesInfo))',
  })
  return ask(
    'google',
    q,
    `${API}?${params}`,
    (data) => ((data as { items?: { volumeInfo?: VolumeInfo }[] }).items ?? []).map((i) => i.volumeInfo ?? {}),
    signal,
    budget,
  )
}

/** Open Library's series field as a series and a number: "Percy Jackson & the Olympians ; bk. 1", "(Discworld -- 3)",
 *  "פרסי ג'קסון והאולימפיים ; 1". Undefined when it holds no number. */
export function openLibrarySeries(text: string | undefined): { series: string; number: string } | undefined {
  const s = (text ?? '').replace(/^[\s(]+|[\s)]+$/g, '').trim()
  const m = /^(.+?)\s*(?:;|--|—|,|#|\s)\s*(?:(?:bk|book|vol|v|no|ספר|כרך|מס)\.?\s*)?#?(\d{1,3})$/iu.exec(s)
  if (!m) return undefined
  const series = m[1]!.replace(/\s*[;:,\-–—]+\s*$/u, '').trim()
  return series && /\p{L}/u.test(series) ? { series, number: String(Number(m[2])) } : undefined
}

type OpenLibraryDetails = { title?: string; subtitle?: string; series?: string[]; authors?: { name?: string }[]; languages?: { key?: string }[] }

/** an Open Library entry in Google Books' shape, its series (when it has one) as the subtitle with the number */
function fromOpenLibrary(d: OpenLibraryDetails & { author_name?: string[]; language?: string[] }): VolumeInfo {
  const series = d.series?.map(openLibrarySeries).find(Boolean)
  return {
    title: d.title,
    ...(series ? { subtitle: series.series, seriesInfo: { bookDisplayNumber: series.number } } : d.subtitle ? { subtitle: d.subtitle } : {}),
    authors: d.author_name ?? (d.authors ?? []).map((a) => a.name ?? '').filter(Boolean),
    language: d.language?.[0] ?? d.languages?.[0]?.key?.split('/').pop(),
  }
}

function openLibraryIsbn(isbn: string, signal?: AbortSignal, budget?: Budget): Promise<VolumeInfo[]> {
  const params = new URLSearchParams({ bibkeys: `ISBN:${isbn}`, format: 'json', jscmd: 'details' })
  return ask(
    'openlibrary',
    `isbn:${isbn}`,
    `${OPEN_LIBRARY}/api/books?${params}`,
    (data) => Object.values((data ?? {}) as Record<string, { details?: OpenLibraryDetails }>).map((e) => fromOpenLibrary(e.details ?? {})),
    signal,
    budget,
  )
}

function openLibrarySearch(title: string, author: string, signal?: AbortSignal, budget?: Budget): Promise<VolumeInfo[]> {
  const params = new URLSearchParams({ title, ...(author && { author }), fields: 'title,subtitle,author_name,language', limit: '20' })
  return ask(
    'openlibrary',
    `title:${title}|author:${author}`,
    `${OPEN_LIBRARY}/search.json?${params}`,
    (data) => ((data as { docs?: (OpenLibraryDetails & { author_name?: string[]; language?: string[] })[] }).docs ?? []).map(fromOpenLibrary),
    signal,
    budget,
  )
}

/** the spellings a Hebrew title may have on Wikidata: with ' or with ׳ (geresh) */
const spellings = (title: string) => [...new Set([title, title.replace(/'/g, '׳'), title.replace(/׳/g, "'")])]
const literal = (s: string, lang: string) => `"${s.replace(/[\\"]/g, ' ').trim()}"@${lang}`

/** Wikidata's works under this very title (their label or another name of theirs) that are part of a series: the series
 *  and the number in it, with the work's authors, in Google Books' shape (the series as the subtitle) */
function wikidataWorks(title: string, lang: 'he' | 'en', signal?: AbortSignal): Promise<VolumeInfo[]> {
  const query = `SELECT ?book ?seriesLabel ?num ?authorLabel WHERE {
  VALUES ?t { ${spellings(title).map((x) => literal(x, lang)).join(' ')} }
  { ?book rdfs:label ?t } UNION { ?book skos:altLabel ?t }
  ?book p:P179 ?st . ?st ps:P179 ?series .
  OPTIONAL { ?st pq:P1545 ?num }
  OPTIONAL { ?book wdt:P50 ?author }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang}" . }
} LIMIT 30`
  type Row = Record<string, { value?: string } | undefined>
  return ask(
    'wikidata',
    `${lang}:${title}`,
    `${WIKIDATA}?${new URLSearchParams({ format: 'json', query })}`,
    (data) => {
      const works = new Map<string, VolumeInfo>()
      for (const r of (data as { results?: { bindings?: Row[] } }).results?.bindings ?? []) {
        const series = r.seriesLabel?.value ?? ''
        const num = r.num?.value ?? ''
        // a series with no name in the book's language comes back as its id ("Q123")
        if (!/^\d{1,3}$/.test(num) || !series || /^Q\d+$/.test(series)) continue
        const key = `${r.book?.value}|${series}|${num}`
        const w = works.get(key) ?? { title, subtitle: series, seriesInfo: { bookDisplayNumber: String(Number(num)) }, authors: [] }
        const a = r.authorLabel?.value
        if (a && !/^Q\d+$/.test(a) && !w.authors!.includes(a)) w.authors!.push(a)
        works.set(key, w)
      }
      return [...works.values()]
    },
    signal,
  )
}

/** The series and number Wikidata has for a title: taken when the work is by the book's author, or when there is no doubt
 *  which series it is. `byAuthor` says whether the author matched. Undefined when it has none. */
async function wikidataSeries(
  title: string,
  author: string,
  hebrewBook: boolean,
  signal?: AbortSignal,
): Promise<{ series: string; number: string; byAuthor: boolean } | undefined> {
  if (!norm(title)) return undefined
  const lang = hebrewBook || hebrew(title) ? 'he' : 'en'
  const works = (await wikidataWorks(title, lang, signal)).filter((w) => norm(w.subtitle ?? '') !== norm(title))
  if (!works.length) return undefined
  const a = norm(author)
  const mine = a ? works.filter((w) => (w.authors ?? []).map(norm).some((x) => x === a || x.includes(a) || a.includes(x))) : []
  const pick = mine.length ? mine : works
  // two different series, or two numbers in one, and nothing to tell them apart: better none than the wrong one
  const kinds = new Set(pick.map((w) => `${norm(w.subtitle ?? '')}|${w.seriesInfo?.bookDisplayNumber}`))
  if (kinds.size !== 1) return undefined
  const w = pick[0]!
  return { series: w.subtitle!, number: w.seriesInfo!.bookDisplayNumber!, byAuthor: mine.length > 0 }
}

/** A catalog's entry for an ISBN; undefined when there is none, or when a Hebrew book's ISBN is the original's (a
 *  translation's copyright page names it too) and the entry is not in Hebrew. Rejects when the network or the service fails. */
async function lookupIsbn(
  isbn: string,
  hebrewBook: boolean,
  signal?: AbortSignal,
  budget?: Budget,
  source: 'google' | 'openlibrary' = 'google',
): Promise<Identified | undefined> {
  const entries = source === 'google' ? await search(`isbn:${isbn}`, signal, budget) : await openLibraryIsbn(isbn, signal, budget)
  const v = entries.find((x) => norm(x.title ?? ''))
  if (!v || (hebrewBook && !hebrew(v.title ?? ''))) return undefined
  return { ...nameOf(v), author: (v.authors ?? []).join(', '), online: true, sites: [SITE[source]], sure: true }
}

/** the library's name completed by the EPUB's package: its title when the library's says nothing, its series when the
 *  library's has none */
function withMeta(local: BookName, meta?: EpubMeta): BookName {
  if (!meta) return local
  let name = local
  if (isJunkTitle(name.title) && meta.title && !isJunkTitle(meta.title)) {
    const own = guessBookName(tidyBookName(meta.title))
    name = own.series || !local.series ? own : { ...local, title: own.title }
  }
  if (!name.series && meta.series && meta.number && norm(meta.series) !== norm(name.title)) name = { ...name, series: meta.series, number: meta.number }
  return name
}

/** What the library already knows: the series its books are named in (with who wrote them), and its authors. */
export interface LibraryNames {
  series: Map<string, { name: string; authors: Set<string> }>
  /** longest first, so "ג'ורג' ר ר מרטין" is tried before "מרטין" */
  authors: string[]
}

/** a series compared across spellings: "פרויקט איקס" is "פרויקט X" */
const seriesKey = (s: string) => norm(s.replace(/איקס/gu, 'x'))

export function libraryNames(books: { title: string; author?: string }[]): LibraryNames {
  const series = new Map<string, { name: string; authors: Set<string> }>()
  const spellings = new Map<string, Map<string, number>>()
  const authors = new Set<string>()
  for (const b of books) {
    const a = (b.author ?? '').trim()
    if (a && !/@/.test(a)) authors.add(a)
    // as the identification reads it, so "פרויקט X #01 - פרויקט X" counts before it is renamed
    const name = guessBookName(tidyBookName(b.title)).series
    const key = name && seriesKey(name)
    if (!key) continue
    const entry = series.get(key) ?? { name, authors: new Set<string>() }
    if (a) entry.authors.add(norm(a))
    series.set(key, entry)
    const count = spellings.get(key) ?? new Map<string, number>()
    count.set(name, (count.get(name) ?? 0) + 1)
    spellings.set(key, count)
  }
  // a series named after the title, with no dash: the same words before a number at the end of two books or more
  // ("הצבע של הקסם עולם הדיסק 1", "מורט עולם הדיסק 4")
  const tails = new Map<string, { name: string; titles: Set<string>; authors: Set<string> }>()
  for (const b of books) {
    const m = /^(.+?)\s+#?(\d{1,3})$/u.exec(tidyBookName(b.title))
    if (!m || guessBookName(tidyBookName(b.title)).series) continue
    const words = m[1]!.split(' ')
    for (let k = 1; k <= Math.min(4, words.length - 1); k++) {
      const name = words.slice(-k).join(' ')
      const key = seriesKey(name)
      // "חלק 2", "כרך 3" are parts of a book, not a series
      if (!/\p{L}{2}/u.test(name) || series.has(key) || /^(?:ה?חלק|ה?כרך|ה?ספר|part|vol\.?|volume|book)$/iu.test(name)) continue
      const t = tails.get(key) ?? { name, titles: new Set<string>(), authors: new Set<string>() }
      t.titles.add(norm(words.slice(0, -k).join(' ')))
      if (b.author?.trim()) t.authors.add(norm(b.author))
      tails.set(key, t)
    }
  }
  for (const [key, t] of tails) {
    if (t.titles.size < 2) continue
    // the longest ending the books share: "עולם הדיסק" rather than "הדיסק"
    const longer = [...tails].some(([k, o]) => k !== key && k.endsWith(` ${key}`) && o.titles.size >= 2)
    if (!longer) series.set(key, { name: t.name, authors: t.authors })
  }
  // the spelling most of the series' books have
  for (const [key, count] of spellings) series.get(key)!.name = [...count].sort((x, y) => y[1] - x[1])[0]![0]
  return { series, authors: [...authors].sort((x, y) => y.length - x.length) }
}

/** a name with its number in the middle and no dash: "שיר של אש ושל קרח 1 משחקי הכס" */
const MIDDLE = /^(.+?)\s+#?(\d{1,3})\s+(.+)$/u

/**
 * A name with no series, split by what the library knows: an author it has, run on at the end, comes off (and becomes
 * the book's author when it has none); a series it has, before a number in the middle, is the series ("שיר של אש ושל
 * קרח 1 משחקי הכס" when the library has "שיר של אש ושל קרח 3 - סופת החרבות"). Sure when that series is the same
 * author's. Undefined when the library tells nothing new.
 */
function byLibrary(name: BookName, author: string, lib?: LibraryNames): { name: BookName; author: string; sure: boolean } | undefined {
  if (!lib) return undefined
  if (name.series) {
    // the spelling the library has for the same series ("פרויקט איקס" when its books are "פרויקט X")
    const known = lib.series.get(seriesKey(name.series))
    if (!known || known.name === name.series) return undefined
    return { name: { ...name, series: known.name }, author, sure: !!author && known.authors.has(norm(author)) }
  }
  let title = name.title
  let who = author
  // an author the library has: run on at the end, or in parentheses ("סיכוי טוב למות (הולי גקסון)")
  for (const a of who ? [who] : lib.authors) {
    const t = withoutAuthor(title, a)
    if (t !== title && norm(t)) {
      title = t
      who = a
      break
    }
  }
  const sureOf = (s: { authors: Set<string> }) => !!who && s.authors.has(norm(who))
  const m = MIDDLE.exec(title)
  const known = m ? lib.series.get(seriesKey(m[1]!)) : undefined
  if (m && known) return { name: { series: known.name, number: String(Number(m[2])), title: m[3]! }, author: who, sure: sureOf(known) }
  // a series the library has at the end, after the title: "תרועת מוות עולם הדיסק 4"
  const end = /^(.+?)\s+#?(\d{1,3})$/u.exec(title)
  if (end) {
    const words = end[1]!.split(' ')
    for (let k = 1; k < words.length; k++) {
      const s = lib.series.get(seriesKey(words.slice(-k).join(' ')))
      if (s) return { name: { series: s.name, number: String(Number(end[2])), title: words.slice(0, -k).join(' ') }, author: who, sure: sureOf(s) }
    }
  }
  return title !== name.title || who !== author ? { name: { ...name, title }, author: who, sure: false } : undefined
}

/** Google Books asked about a name with its number in the middle, as the series and the title around the number: the
 *  title with the series in it ("הארי פוטר ואבן החכמים"), then the title alone. Taken only when the catalog's entry
 *  names both: the title, and the series in its title or its series. */
async function lookupSplit(
  series: string,
  number: string,
  rest: string,
  author: string,
  signal?: AbortSignal,
  budget?: Budget,
  source: 'google' | 'openlibrary' = 'google',
): Promise<Identified | undefined> {
  for (const title of [`${series} ${rest}`, rest]) {
    const f = await lookupOnline({ title, author }, signal, budget, source)
    if (!f) continue
    const t = norm(f.title)
    if (!t.includes(norm(rest)) || !(t.includes(norm(series)) || norm(f.series).includes(norm(series)))) continue
    return { ...f, series: f.series || series, number: f.series ? f.number : String(Number(number)) }
  }
  return undefined
}

const quoted = (s: string) => `"${s.replace(/"/g, ' ').trim()}"`

/** A catalog's best match for a title (and author, when known); undefined when nothing fits.
 *  Rejects when the network or the service fails. */
export async function lookupOnline(
  want: { title: string; author: string },
  signal?: AbortSignal,
  budget?: Budget,
  source: 'google' | 'openlibrary' = 'google',
): Promise<Identified | undefined> {
  if (!norm(want.title)) return undefined
  const author = want.author.trim()
  // a line of several words may hold the title among other words ("והאלים של אוסגרד להב הקיץ", two lines of the title
  // page joined by the conversion): asked by its words and the author, not as one exact title
  const loose = author && norm(want.title).split(' ').length >= 3 ? [`${norm(want.title)} inauthor:${quoted(author)}`] : []
  const queries: (() => Promise<VolumeInfo[]>)[] =
    source === 'openlibrary'
      ? [...(author ? [() => openLibrarySearch(want.title, author, signal, budget)] : []), () => openLibrarySearch(want.title, '', signal, budget)]
      : (author
          ? [`intitle:${quoted(want.title)} inauthor:${quoted(author)}`, ...loose, `intitle:${quoted(want.title)}`]
          : [`intitle:${quoted(want.title)}`]
        ).map((q) => () => search(q, signal, budget))
  for (const q of queries) {
    let best: { s: number; v: VolumeInfo; name: BookName } | undefined
    for (const v of await q()) {
      const name = nameOf(v)
      const s = score(v, name, want)
      if (s && (!best || s > best.s)) best = { s, v, name }
    }
    // the very same title by the same author: no doubt left about which book it is (a title found among a line's
    // words is not that sure)
    const same = best && norm(best.name.title) === norm(want.title) && best.s >= 7
    if (best) return { ...best.name, author: (best.v.authors ?? []).join(', '), online: true, sites: [SITE[source]], ...(same && { sure: true }) }
  }
  return undefined
}

/**
 * The book's name in the template and its author. It is read from the library's names, completed by the EPUB's package
 * (`meta`: its series, or its title when the library's says nothing), and when they hold no series or say nothing
 * ("1~2402 1"), from the book's opening lines (`opening`, see lib/bookText). `online` decides whether Google Books is
 * asked: first by the ISBNs in the package and the opening lines, then by that name and by the opening's lines that may be
 * the title. What it finds completes the name (a series, a fuller title, a missing author), but never replaces a series or
 * an author already known; a book found by its ISBN also takes the catalog's title. A failed lookup falls back to what was
 * read; only an abort rejects.
 */
export async function identifyBook(
  b: { title: string; author: string; fileName: string },
  online: boolean,
  signal?: AbortSignal,
  opening: string[] = [],
  meta?: EpubMeta,
  /** the library's series and authors (libraryNames), which split a name that has no dash */
  library?: LibraryNames,
): Promise<Identified> {
  // an e-mail address in the author field (a file's uploader) is no author
  // and an Anna's Archive name carries its author
  const author = (/@/.test(b.author) ? '' : b.author.trim()) || authorInName(b.title) || authorInName(stem(b.fileName))
  const lib = byLibrary(identifyLocally({ ...b, author }), author, library)
  b = { ...b, author: lib?.author ?? author }
  const local = lib?.name ?? identifyLocally(b)
  const own = withMeta(local, meta)
  const fromMeta = own !== local
  // a series in the EPUB's package was put there by whoever made the book: sure enough to save without asking
  const metaSure = fromMeta && !!own.series && !local.series
  const read = opening.length ? nameFromOpening(opening, b.author) : { candidates: [] as string[] }
  // a Hebrew book keeps a Hebrew name, rather than the original's name from its copyright page
  const hebrewBook = hebrew(b.title) || opening.some(hebrew)
  // the opening pages name the book only when its title says nothing, or when they name this very title: otherwise the
  // line they took may be a publisher's address, a review or another book in the series
  const sameTitle = (x: string, y: string) => !!norm(x) && !!norm(y) && (norm(x).includes(norm(y)) || norm(y).includes(norm(x)))
  const fromText =
    !!read.name &&
    (!hebrewBook || hebrew(read.name.title)) &&
    (!own.series || isJunkTitle(own.title)) &&
    (isJunkTitle(own.title) || sameTitle(read.name.title, own.title))
  const base: BookName = fromText ? read.name! : own
  const libSure = !!lib?.sure && base === local
  const mine: Identified = {
    ...base,
    author: b.author.trim(),
    online: false,
    ...(fromText ? { fromText } : fromMeta && { fromMeta, ...(metaSure && { sure: true }) }),
    ...(libSure && { sure: true }),
  }
  if (!online) return mine
  const known = !isJunkTitle(base.title)
  // a book whose name already has a series, a title and an author has nothing to ask Google Books about
  if (known && base.series && b.author.trim()) return mine
  const isbns = bookIsbns([...(meta?.identifiers ?? []), ...opening], hebrewBook).slice(0, 2)
  const wants = [...(known ? [base.title] : []), ...read.candidates.filter((c) => norm(c) !== norm(base.title))].slice(0, 4)
  const middle = !base.series ? MIDDLE.exec(base.title) : null
  type Ask = [() => Promise<Identified | undefined>, boolean]
  // each ask, and whether what it finds is this very book (so the catalog's title is taken over the library's)
  const asksOf = (source: 'google' | 'openlibrary', budget: Budget): Ask[] => [
    ...isbns.map((isbn): Ask => [() => lookupIsbn(isbn, hebrewBook, signal, budget, source), true]),
    ...(middle ? [[() => lookupSplit(middle[1]!, middle[2]!, middle[3]!, b.author, signal, budget, source), true] as Ask] : []),
    ...wants.map((title): Ask => [() => lookupOnline({ title, author: b.author }, signal, budget, source), false]),
  ]
  let found: Identified | undefined
  let thisBook = false
  // why Google Books did not answer; Open Library is asked then, and the book is checked again later only when it had
  // nothing either
  let down: 'quota' | 'network' | undefined
  for (const [source, perBook] of [['google', PER_BOOK], ['openlibrary', OPEN_LIBRARY_PER_BOOK]] as const) {
    for (const [ask, exact] of asksOf(source, { left: perBook })) {
      try {
        found = await ask()
      } catch (e) {
        if (signal?.aborted) throw e
        console.warn(e)
        if (source === 'google') down = e instanceof BooksUnavailable ? e.why : 'network'
        break
      }
      if (found) {
        thisBook = exact
        break
      }
    }
    if (found) break
  }
  if (!found) return withWikidata(down ? { ...mine, failed: true, why: down } : mine, hebrewBook, signal)
  const sure = found.sure || (metaSure && !fromText) || libSure
  return withWikidata({
    ...(sure && { sure }),
    series: base.series || found.series,
    number: base.series ? base.number : found.number,
    // a fuller title ("הארי פוטר ואבן" -> "הארי פוטר ואבן החכמים"), never a shorter one; any title over one that says
    // nothing; and the catalog's title for a book found by its ISBN, which is that very book
    title: !known || thisBook || norm(found.title).includes(norm(base.title)) ? found.title : base.title,
    // a Hebrew book keeps a Hebrew author name, rather than the original's "Rick Riordan"
    author: mine.author || (hebrew(found.author) === (known ? hebrew(base.title) : hebrewBook) ? found.author : ''),
    online: true,
    ...(found.sites && { sites: found.sites }),
  }, hebrewBook, signal)
}

/** A name still with no series, completed by the series and number Wikidata has for its title. Saved without asking only
 *  when it was sure before and the work on Wikidata is by the same author. Wikidata failing leaves the name as it was. */
async function withWikidata(r: Identified, hebrewBook: boolean, signal?: AbortSignal): Promise<Identified> {
  if (r.series || isJunkTitle(r.title)) return r
  let w: Awaited<ReturnType<typeof wikidataSeries>>
  try {
    w = await wikidataSeries(r.title, r.author, hebrewBook, signal)
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn(e)
    return r
  }
  if (!w || (hebrewBook && !hebrew(w.series))) return r
  const { sure, ...rest } = r
  return {
    ...rest,
    series: w.series,
    number: w.number,
    online: true,
    sites: [...(r.sites ?? []), SITE.wikidata],
    ...(sure && w.byAuthor && { sure }),
  }
}
