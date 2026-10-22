// Identifying a book: its series, number, full title and author, read first from what the library has (the title and the
// file name it was added under), the EPUB's own package and the opening pages, and then completed from the catalogs online,
// none of which needs a key: Google Books first, by the book's ISBN, which names the edition exactly, then by its title;
// Open Library the same way when Google Books found nothing or did not answer; and Wikidata for the series and its number
// when the name still has no series. Only the ISBN, the title and the author are sent, and only after the user agreed
// (consent 'books').

import { authorInName, guessBookName, isJunkTitle, nameFromOpening, seriesOf, tidyBookName, withoutAuthor, type BookName } from './bookName'
import type { EpubMeta } from './bookText'
import { bookNumber, copyrightYear, seriesByWords, inLists, librarySeriesFor, numberByGaps, originalSeries, originalSeriesName, originalTitle, seriesByNames, soundOf, titleCase } from './bookInference'
import { listsOf, rememberLists } from './bookKnowledge'
import { hasConsent } from './consent'
import { blocks, clueStats, trusted } from './identifyLearning'
import { bookIsbns } from './isbn'
import { norm } from './sameBook'
import { loadSettings } from './settings'

export interface Identified extends BookName {
  author: string
  /** whether a catalog online found the book; otherwise the result is what the library's own names gave */
  online: boolean
  /** the catalogs that gave what was found ("Google Books", "Open Library", "Wikidata") */
  sites?: string[]
  /** the clues that agree with the name (weigh) */
  evidence?: Clue[]
  /** the clues that say otherwise: the name is not saved without asking then */
  conflicts?: Clue[]
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
  /** Wikidata's id of the series ("Q123"), for its whole list of books */
  seriesId?: string
}

const hebrew = (s: string) => /[֐-׿]/.test(s)
const stem = (fileName: string) => fileName.replace(/\.[^.]+$/, '')

/** What the library's own names say: the title, and when that holds no series, the file name it was added under. */
export function identifyLocally(b: { title: string; author: string; fileName: string }): BookName {
  // the author's name is taken off both sides of the cleaning: before it, where a dash sets it apart, and after it, where
  // underscores ran it on to the end ("קלע_הכשף_#5_קוטל_המלכה_סבסטיאן_דה_קסטל")
  const tidy = (name: string) => unjoined(guessBookName(withoutAuthor(tidyBookName(withoutAuthor(name, b.author)), b.author)))
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
  down.clear()
}

/** Open Library or Wikidata that could not be reached (no answer at all, which in a browser is also what an answer
 *  without CORS headers looks like) is left alone for a while in this session, instead of failing again for every book */
const down = new Map<Source, number>()
const DOWN_MS = 10 * 60 * 1000

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
/** the user's Google Books key, when there is one: its quota is its own, so a refusal without it does not stop it */
const googleKey = () => (loadSettings().googleBooksKey ?? '').trim()
const blockKey = (source: Source) => (source === 'google' ? (googleKey() ? `${BLOCK_KEY}:key` : BLOCK_KEY) : `${BLOCK_KEY}:${source}`)
const blockedUntil = (source: Source) => Number(globalThis.localStorage?.getItem(blockKey(source)) ?? 0) || 0

/** How each catalog answered since the last reset: shown after identifying, so a run that found nothing says why */
export type CatalogStats = Record<Source, { ok: number; quota: number; network: number; /** the last failure, as told */ last?: string }>
const fresh = (): CatalogStats => ({ google: { ok: 0, quota: 0, network: 0 }, openlibrary: { ok: 0, quota: 0, network: 0 }, wikidata: { ok: 0, quota: 0, network: 0 } })
let stats = fresh()
export function resetCatalogStats() {
  stats = fresh()
}
export function catalogStats(): CatalogStats {
  return stats
}
export const CATALOG_NAMES = SITE

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
  if (known) {
    stats[source].ok++
    return known
  }
  const fail = (why: 'quota' | 'network', message: string, last = message) => {
    stats[source][why]++
    if (why === 'network') stats[source].last = last
    return new BooksUnavailable(why, message)
  }
  if (Date.now() < blockedUntil(source)) throw fail('quota', `${SITE[source]} refused recently`)
  if (Date.now() < (down.get(source) ?? 0)) throw new BooksUnavailable('network', `${SITE[source]} did not answer a moment ago`)
  if (budget) {
    if (budget.left <= 0) return []
    budget.left--
  }
  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch (e) {
    if (signal?.aborted) throw e
    if (source !== 'google') down.set(source, Date.now() + DOWN_MS)
    throw fail('network', e instanceof Error ? e.message : String(e), `${e instanceof Error ? e.name : 'Error'}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (res?.status === 429 || res?.status === 403) {
    try {
      localStorage.setItem(blockKey(source), String(Date.now() + BLOCK_MS))
    } catch {
      /* storage unavailable */
    }
    // with the user's own key a refusal may be the key's fault (the Books API not enabled for it): its reason is told
    if (source === 'google' && googleKey()) stats[source].last = `HTTP ${res.status}${await errorOf(res)}`
    throw fail('quota', `${SITE[source]} answered ${res.status}`)
  }
  if (source === 'google' && res?.status === 400 && googleKey()) {
    throw fail('network', `${SITE[source]} answered 400`, `HTTP 400${await errorOf(res)}`)
  }
  if (!res?.ok) throw fail('network', `${SITE[source]} answered ${res?.status}`, `HTTP ${res?.status}`)
  let items: VolumeInfo[]
  try {
    items = parse(await res.json())
  } catch (e) {
    throw fail('network', `${SITE[source]} sent an answer that could not be read: ${e instanceof Error ? e.message : String(e)}`, 'unreadable answer')
  }
  stats[source].ok++
  remember(key, items)
  return items
}

/** Google's reason for an error answer (": API key not valid"), or nothing when it gave none */
async function errorOf(res: Response): Promise<string> {
  try {
    const m = ((await res.clone().json()) as { error?: { message?: string } }).error?.message
    return m ? `: ${m.slice(0, 120)}` : ''
  } catch {
    return ''
  }
}

/** Whether a Google Books key works: undefined when it does, otherwise what Google said */
export async function testGoogleBooksKey(key: string): Promise<string | undefined> {
  const params = new URLSearchParams({ q: 'isbn:9780306406157', maxResults: '1', fields: 'totalItems', key: key.trim() })
  try {
    const res = await fetch(`${API}?${params}`)
    if (res.ok) {
      // a key that works starts with a fresh quota of its own
      try {
        localStorage.removeItem(`${BLOCK_KEY}:key`)
      } catch {
        /* storage unavailable */
      }
      return undefined
    }
    return `HTTP ${res.status}${await errorOf(res)}`
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

function search(q: string, signal?: AbortSignal, budget?: Budget): Promise<VolumeInfo[]> {
  const key = googleKey()
  const params = new URLSearchParams({
    q,
    maxResults: '20',
    printType: 'books',
    fields: 'items(volumeInfo(title,subtitle,authors,language,seriesInfo))',
    ...(key && { key }),
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

const WIKIDATA_SEARCH = 'https://www.wikidata.org/w/api.php'
const WIKIDATA_PER_BOOK = 4
type Row = Record<string, { value?: string } | undefined>
const qid = (uri: string | undefined) => /Q\d+$/.exec(uri ?? '')?.[0] ?? ''
const noLabel = (s: string) => !s || /^Q\d+$/.test(s)

/** The Wikidata items named so (in their label or another of their names, compared without punctuation, so ' and ׳
 *  or a dash do not matter), found by Wikidata's own search. Kept as entries whose title is the item's id. */
function wikidataItems(text: string, lang: 'he' | 'en', signal?: AbortSignal, budget?: Budget): Promise<VolumeInfo[]> {
  const params = new URLSearchParams({ action: 'wbsearchentities', search: text, language: lang, uselang: lang, type: 'item', limit: '10', format: 'json', origin: '*' })
  type Hit = { id?: string; label?: string; aliases?: string[]; match?: { text?: string } }
  return ask(
    'wikidata',
    `search:${lang}:${text}`,
    `${WIKIDATA_SEARCH}?${params}`,
    (data) =>
      ((data as { search?: Hit[] }).search ?? [])
        .filter((h) => h.id && [h.match?.text, h.label, ...(h.aliases ?? [])].some((x) => !!x && norm(x) === norm(text)))
        .map((h) => ({ title: h.id })),
    signal,
    budget,
  )
}

function sparql(key: string, query: string, parse: (rows: Row[]) => VolumeInfo[], signal?: AbortSignal, budget?: Budget) {
  return ask('wikidata', key, `${WIKIDATA}?${new URLSearchParams({ format: 'json', query })}`, (data) => parse((data as { results?: { bindings?: Row[] } }).results?.bindings ?? []), signal, budget)
}

/** these works' series and their number in it, with their authors, in Google Books' shape (the series as the subtitle) */
function wikidataWorks(ids: string[], title: string, lang: 'he' | 'en', signal?: AbortSignal, budget?: Budget): Promise<VolumeInfo[]> {
  const query = `SELECT ?book ?series ?seriesLabel ?num ?authorLabel WHERE {
  VALUES ?book { ${ids.map((i) => `wd:${i}`).join(' ')} }
  ?book p:P179 ?st . ?st ps:P179 ?series .
  OPTIONAL { ?st pq:P1545 ?num }
  OPTIONAL { ?book wdt:P50 ?author }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang}" . }
} LIMIT 50`
  return sparql(
    `works:${lang}:${ids.join(',')}`,
    query,
    (rows) => {
      const works = new Map<string, VolumeInfo>()
      for (const r of rows) {
        const series = r.seriesLabel?.value ?? ''
        const num = r.num?.value ?? ''
        // a series with no name in the book's language comes back as its id ("Q123")
        if (!/^\d{1,3}$/.test(num) || noLabel(series)) continue
        const key = `${qid(r.book?.value)}|${series}|${num}`
        const w = works.get(key) ?? { title, subtitle: series, seriesInfo: { bookDisplayNumber: String(Number(num)) }, authors: [], seriesId: qid(r.series?.value) }
        const a = r.authorLabel?.value ?? ''
        if (!noLabel(a) && !w.authors!.includes(a)) w.authors!.push(a)
        works.set(key, w)
      }
      return [...works.values()]
    },
    signal,
    budget,
  )
}

/** the works numbered so in these series: their title, the series and their authors */
function wikidataNumbered(ids: string[], number: string, lang: 'he' | 'en', signal?: AbortSignal, budget?: Budget): Promise<VolumeInfo[]> {
  const query = `SELECT ?book ?bookLabel ?series ?seriesLabel ?authorLabel WHERE {
  VALUES ?series { ${ids.map((i) => `wd:${i}`).join(' ')} }
  ?book p:P179 ?st . ?st ps:P179 ?series ; pq:P1545 "${number}" .
  OPTIONAL { ?book wdt:P50 ?author }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang}" . }
} LIMIT 20`
  return sparql(
    `numbered:${lang}:${ids.join(',')}:${number}`,
    query,
    (rows) => {
      const works = new Map<string, VolumeInfo>()
      for (const r of rows) {
        const title = r.bookLabel?.value ?? ''
        const series = r.seriesLabel?.value ?? ''
        if (noLabel(title) || noLabel(series)) continue
        const key = qid(r.book?.value)
        const w = works.get(key) ?? { title, subtitle: series, seriesInfo: { bookDisplayNumber: number }, authors: [], seriesId: qid(r.series?.value) }
        const a = r.authorLabel?.value ?? ''
        if (!noLabel(a) && !w.authors!.includes(a)) w.authors!.push(a)
        works.set(key, w)
      }
      return [...works.values()]
    },
    signal,
    budget,
  )
}

/** every numbered book of a series on Wikidata, by its title in the book's language: the series' whole list */
function wikidataSeriesBooks(id: string, lang: 'he' | 'en', signal?: AbortSignal, budget?: Budget): Promise<VolumeInfo[]> {
  const query = `SELECT ?book ?bookLabel ?num WHERE {
  ?book p:P179 ?st . ?st ps:P179 wd:${id} ; pq:P1545 ?num .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang}" . }
} LIMIT 80`
  return sparql(
    `series-books:${lang}:${id}`,
    query,
    (rows) =>
      rows
        .filter((r) => /^\d{1,3}$/.test(r.num?.value ?? '') && !noLabel(r.bookLabel?.value ?? ''))
        .map((r) => ({ title: r.bookLabel!.value, seriesInfo: { bookDisplayNumber: String(Number(r.num!.value)) } })),
    signal,
    budget,
  )
}

/**
 * Wikidata named a book's series: its whole list of books is kept on the device under the name the library gives the
 * series (bookKnowledge), so the series' other books are identified by their titles from now on, offline. Wikidata
 * failing keeps nothing.
 */
async function learnSeries(id: string | undefined, series: string, author: string, lang: 'he' | 'en', signal?: AbortSignal) {
  if (!id) return
  try {
    const books = (await wikidataSeriesBooks(id, lang, signal, { left: 1 }))
      .filter((b) => lang !== 'he' || hebrew(b.title ?? ''))
      .map((b) => ({ title: withoutSeries(b.title!, series), number: b.seriesInfo!.bookDisplayNumber! }))
    // one title for each number: a number Wikidata gives two works (an edition, a part) says nothing sure
    const once = books.filter((b) => books.filter((x) => x.number === b.number).length === 1)
    if (once.length >= 2) rememberLists([{ series, books: once }], author, 'wikidata')
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn(e)
  }
}

const byAuthor = (w: VolumeInfo, author: string) => {
  const a = norm(author)
  return !!a && (w.authors ?? []).map(norm).some((x) => x === a || x.includes(a) || a.includes(x))
}

/** One work out of several that may fit: the author's when that tells them apart; none when two different ones are left */
function onlyOne(works: VolumeInfo[], author: string): { work: VolumeInfo; byAuthor: boolean } | undefined {
  if (!works.length) return undefined
  const mine = works.filter((w) => byAuthor(w, author))
  const pick = mine.length ? mine : works
  const kinds = new Set(pick.map((w) => `${norm(w.title ?? '')}|${norm(w.subtitle ?? '')}|${w.seriesInfo?.bookDisplayNumber}`))
  return kinds.size === 1 ? { work: pick[0]!, byAuthor: mine.length > 0 } : undefined
}

/** The series and number Wikidata has for a title. Undefined when it has none, or cannot tell which. */
async function wikidataSeries(
  title: string,
  author: string,
  lang: 'he' | 'en',
  signal?: AbortSignal,
  budget?: Budget,
): Promise<{ series: string; number: string; byAuthor: boolean; seriesId?: string } | undefined> {
  const ids = (await wikidataItems(title, lang, signal, budget)).map((i) => i.title!).slice(0, 8)
  if (!ids.length) return undefined
  const works = (await wikidataWorks(ids, title, lang, signal, budget)).filter((w) => norm(w.subtitle ?? '') !== norm(title))
  const one = onlyOne(works, author)
  return one && { series: one.work.subtitle!, number: one.work.seriesInfo!.bookDisplayNumber!, byAuthor: one.byAuthor, seriesId: one.work.seriesId }
}

/** A name that is a series and a number with no title ("משפחת קיין 1"): the work Wikidata has at that number. */
async function wikidataByNumber(
  series: string,
  number: string,
  author: string,
  lang: 'he' | 'en',
  signal?: AbortSignal,
  budget?: Budget,
): Promise<{ series: string; title: string; author: string; byAuthor: boolean; seriesId?: string } | undefined> {
  const ids = (await wikidataItems(series, lang, signal, budget)).map((i) => i.title!).slice(0, 8)
  if (!ids.length) return undefined
  const one = onlyOne(await wikidataNumbered(ids, number, lang, signal, budget), author)
  return one && { series: one.work.subtitle!, title: one.work.title!, author: (one.work.authors ?? []).join(', '), byAuthor: one.byAuthor, seriesId: one.work.seriesId }
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
  /** each series with its authors and the books the library has in it, by number */
  series: Map<string, { name: string; authors: Set<string>; members?: { number: number; id?: string; kind?: string; title?: string }[] }>
  /** the series each titled book of a series is in, by its title */
  titles?: Map<string, string>
  /** longest first, so "ג'ורג' ר ר מרטין" is tried before "מרטין" */
  authors: string[]
}

/** a series compared across spellings: "פרויקט איקס" is "פרויקט X" */
const seriesKey = (s: string) => norm(s.replace(/איקס/gu, 'x'))

export function libraryNames(books: { title: string; author?: string; id?: string; kind?: string }[]): LibraryNames {
  const series: LibraryNames['series'] = new Map()
  const titles = new Map<string, string>()
  const spellings = new Map<string, Map<string, number>>()
  const authors = new Set<string>()
  for (const b of books) {
    const a = (b.author ?? '').trim()
    if (a && !/@/.test(a)) authors.add(a)
    // as the identification reads it, so "פרויקט X #01 - פרויקט X" counts before it is renamed
    const guess = unjoined(guessBookName(tidyBookName(b.title)))
    const name = guess.series
    const key = name && seriesKey(name)
    if (!key) continue
    const entry = series.get(key) ?? { name, authors: new Set<string>(), members: [] }
    if (a) entry.authors.add(norm(a))
    if (norm(guess.title)) titles.set(norm(guess.title), name)
    // a book of the series with no number counts too (as 0): the years may order it
    const n = Number(guess.number) || 0
    if (Number.isInteger(n) && n >= 0) entry.members!.push({ number: n, title: guess.title, ...(b.id && { id: b.id }), ...(b.kind && { kind: b.kind }) })
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
      if (joining(name)) continue
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
  return { series, titles, authors: [...authors].sort((x, y) => y.length - x.length) }
}

/** a name with its number in the middle and no dash: "שיר של אש ושל קרח 1 משחקי הכס" */
const MIDDLE = /^(.+?)\s+#?(\d{1,3})\s+(.+)$/u

/**
 * A name with no series, split by what the library knows: an author it has, run on at the end, comes off (and becomes
 * the book's author when it has none); a series it has, before a number in the middle, is the series ("שיר של אש ושל
 * קרח 1 משחקי הכס" when the library has "שיר של אש ושל קרח 3 - סופת החרבות"). Sure when that series is the same
 * author's. Undefined when the library tells nothing new.
 */
/** A name whose series is a joining word ("על 10 - לחלום", saved by a mistake of an earlier version) is the title it was
 *  made of: "לחלום על 10" */
function unjoined(n: BookName): BookName {
  return n.series && joining(n.series) ? { series: '', number: '', title: [n.title, n.series, n.number].filter(Boolean).join(' ') } : n
}

/** A word that only joins a title to the number it ends with ("לחלום על 10", "לשחרר את 10", "Dreaming of 10"): the
 *  number is the title's own, and the word names no series. Compared without marks or punctuation. */
function joining(name: string): boolean {
  return /^(?:על|את|של|עם|אל|לא|כל|זה|זו|גם|רק|אני|הוא|היא|אתה|מה|מי|כי|אם|לו|לי|לה|בו|בה|ב|ל|מ|ו|the|of|a|an|and|to|for|in|on|at)$/iu.test(norm(name))
}

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
      const s = joining(words.slice(-k).join(' ')) ? undefined : lib.series.get(seriesKey(words.slice(-k).join(' ')))
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
  const r = tidyName(await findName(b, online, signal, opening, meta, library))
  return weigh(r, b, opening, meta, library, signal)
}

async function findName(
  b: { title: string; author: string; fileName: string },
  online: boolean,
  signal?: AbortSignal,
  opening: string[] = [],
  meta?: EpubMeta,
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
  let base: BookName = fromText ? read.name! : own
  // a translated book whose copyright page names the original series and number ("MAGISTERIUM V"), when the library
  // has that series in Hebrew: the library's series and the number, the title kept when it is one
  const original = !base.series && library ? originalSeries(opening) : undefined
  const fromSeries = original && librarySeriesFor(original.series, b.author, library!.series.values(), norm)
  // the original series with no number ("MAGISTERIUM" alone), as the library names it
  const nameOnly =
    !base.series && !fromSeries && library ? originalSeriesName([...opening, ...(meta?.running ?? [])], b.author, library.series.values(), norm) : undefined
  let fromOriginal = !!fromSeries || !!nameOnly
  if (fromSeries) base = { series: fromSeries, number: original!.number, title: isJunkTitle(base.title) ? '' : base.title }
  else if (nameOnly) base = { series: nameOnly, number: '', title: isJunkTitle(base.title) ? '' : base.title }
  // a list of the series' books that names this title, printed in this book or in another one read before
  if (meta?.lists?.length) rememberLists(meta.lists, b.author)
  if (!base.number && !isJunkTitle(base.title)) {
    const listed = inLists(base.title, [...(meta?.lists ?? []), ...listsOf(b.author)], norm)
    // a list that does not name its series is the series of another book of it the library has
    const series =
      listed &&
      (listed.series
        ? asLibrarySeries(listed.series, b.author, library)
        : base.series || listed.others.map((t) => library?.titles?.get(norm(t))).find(Boolean) || '')
    if (listed && series && (!base.series || sameTitle(series, base.series) || !listed.series)) {
      base = { ...base, series: base.series || series, number: listed.number }
      fromOriginal = true
    }
  }
  // the book it says it follows, or the one it says comes next, when the library knows where that one stands
  if (!base.number && (meta?.prev?.length || meta?.next?.length)) {
    const q = bySequels(meta, b.author, library)
    if (q && (!base.series || sameSeries(q.series, base.series))) {
      base = { ...base, series: base.series || q.series, number: q.number }
      fromOriginal = true
    }
  }
  // still no series: the author's series in the library whose books share the most names with this one (its characters)
  if (!base.series && library && b.author.trim() && meta?.names?.length) {
    const s = await seriesOfNames(meta.names, b.author, library, signal)
    if (s) {
      base = { ...base, series: s, number: '' }
      fromOriginal = true
    }
  }
  // still no series: the series whose fingerprint (the vocabulary its books share, weighed by how rare it is in the
  // library) this book's vocabulary has; with no author too, against the books already read
  // (not for a name already in two parts, "המרדף - אוניברסיטת בראייר": one of them may be its own series)
  if (!base.series && library && meta?.words?.length && !/\s[-–—]\s/u.test(base.title)) {
    try {
      const s = await seriesOfWords(meta.words, b.author, library, (b as { id?: string }).id, signal)
      if (s) {
        base = { ...base, series: s, number: '' }
        fromOriginal = true
      }
    } catch (e) {
      if (signal?.aborted) throw e
    }
  }
  // a series with no number: the number the library's books of the series leave for it, by their years when need be
  if (base.series && !base.number && library) {
    // this book is one of the series for the books after it in this run (its year read with theirs)
    const self = b as { id?: string; kind?: string }
    const entry = library.series.get(seriesKey(base.series))
    if (entry && self.id && !entry.members?.some((m) => m.id === self.id))
      (entry.members ??= []).push({ number: 0, title: base.title, id: self.id, ...(self.kind && { kind: self.kind }) })
    const n = await numberInLibrary(base.series, copyrightYear(opening), library, signal, self.id)
    if (n) {
      // the number is given: the next book of this run is not offered it too
      const me = entry?.members?.find((m) => self.id && m.id === self.id)
      if (me) me.number = n
      else entry?.members?.push({ number: n, title: base.title })
      base = { ...base, number: String(n) }
      fromOriginal = true
    }
  }
  // still no number: the number Wikidata gives the original (its title on the copyright page) in its series
  let numberedOnline = false
  if (base.series && !base.number && online) {
    const t = originalTitle(opening)
    const holder = /copyright\s*©?\s*\d{4}\s+by\s+([A-Za-z.' -]+?)(?:\s+LLC|\s+Inc\.?|,|$)/i.exec(opening.find((l) => /copyright.*\bby\b/i.test(l)) ?? '')?.[1] ?? ''
    const n = t ? await originalNumber(t, holder.trim(), signal) : undefined
    if (n) {
      base = { ...base, number: n }
      fromOriginal = true
      numberedOnline = true
    }
  }
  // a title that says nothing, from the PDF's running head: the line printed on many pages that is neither its series
  // nor its author (and in Hebrew for a Hebrew book)
  const running = noTitle(base)
    ? meta?.running?.find(
        (r) => !isJunkTitle(r) && (!hebrewBook || hebrew(r)) && !sameTitle(r, base.series) && !sameTitle(r, b.author) && !sameTitle(r, own.series),
      )
    : undefined
  const fromRunning = !!running
  if (running) {
    const head = guessBookName(running)
    base = base.series ? { ...base, title: head.series && sameTitle(head.series, base.series) ? head.title : running } : head
  }
  // still no title, for a series inferred from the copyright page: the original title there, translated
  const originalName = original?.title ?? originalTitle(opening)
  if (base.series && noTitle(base) && originalName && online && hasConsent('translate')) {
    const he = await translatedTitle(originalName, signal)
    if (he) base = { ...base, title: he }
  }
  const libSure = !!lib?.sure && base === local
  const mine: Identified = {
    ...base,
    author: b.author.trim(),
    online: false,
    ...(fromText || fromOriginal || fromRunning ? { fromText: true } : fromMeta && { fromMeta, ...(metaSure && { sure: true }) }),
    ...(libSure && { sure: true }),
    ...(numberedOnline && { sites: [SITE.wikidata] }),
  }
  if (!online) return mine
  const known = !isJunkTitle(base.title)
  // a book whose name already has a series, a title and an author has nothing to ask Google Books about
  if (known && base.series && b.author.trim() && !noTitle(base)) return mine
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
  if (!found) return withWikidata(down ? { ...mine, failed: true, why: down } : mine, hebrewBook, signal, library)
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
  }, hebrewBook, signal, library)
}

/** A name still with no series, completed by Wikidata: the series and number it has for the title, or, for a name that
 *  is a series and a number with no title ("משפחת קיין 1"), the title of the work at that number. Saved without asking
 *  only when it was sure before and the work on Wikidata is by the same author. Wikidata failing leaves the name as it was. */
async function withWikidata(r: Identified, hebrewBook: boolean, signal?: AbortSignal, library?: LibraryNames): Promise<Identified> {
  // a series and a number with no title (inferred from the copyright page): the title of the work at that number
  if (r.series && r.number && noTitle(r)) {
    try {
      const lang = hebrewBook || hebrew(r.series) ? 'he' : 'en'
      const n = await wikidataByNumber(r.series, r.number, r.author, lang, signal, { left: WIKIDATA_PER_BOOK })
      if (n && (!hebrewBook || hebrew(n.title))) {
        await learnSeries(n.seriesId, r.series, r.author, lang, signal)
        return { ...r, title: n.title, online: true, sites: [...(r.sites ?? []), SITE.wikidata] }
      }
    } catch (e) {
      if (signal?.aborted) throw e
      console.warn(e)
    }
    return r
  }
  if (r.series || isJunkTitle(r.title)) return r
  const lang = hebrewBook || hebrew(r.title) ? 'he' : 'en'
  const budget: Budget = { left: WIKIDATA_PER_BOOK }
  const { sure, ...rest } = r
  const sites = [...(r.sites ?? []), SITE.wikidata]
  try {
    const numbered = /^(.+?)\s+#?(\d{1,3})$/u.exec(r.title)
    if (numbered) {
      const n = await wikidataByNumber(numbered[1]!, String(Number(numbered[2])), r.author, lang, signal, budget)
      if (n && (!hebrewBook || (hebrew(n.series) && hebrew(n.title)))) {
        const author = r.author || (hebrew(n.author) === hebrewBook ? n.author : '')
        const series = asLibrarySeries(n.series, author, library)
        await learnSeries(n.seriesId, series, author, lang, signal)
        return { ...rest, series, number: String(Number(numbered[2])), title: withoutSeries(n.title, series, n.series), author, online: true, sites }
      }
    }
    const w = await wikidataSeries(r.title, r.author, lang, signal, budget)
    if (!w || (hebrewBook && !hebrew(w.series))) return r
    const series = asLibrarySeries(w.series, r.author, library)
    await learnSeries(w.seriesId, series, r.author, lang, signal)
    return { ...rest, series, number: w.number, title: withoutSeries(r.title, series, w.series), online: true, sites, ...(sure && w.byAuthor && { sure }) }
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn(e)
    return r
  }
}

/** The name the library already has for a catalog's series, so one series is not saved under two names: the same series
 *  in another spelling, or (for a series of this author's in the library) a shorter or longer form of it — the library's
 *  "פרסי ג'קסון" for Wikidata's "פרסי ג'קסון והאולימפיים". The longest such name wins; the catalog's name otherwise. */
export function asLibrarySeries(series: string, author: string, library?: LibraryNames): string {
  if (!library || !series) return series
  const key = seriesKey(series)
  const same = library.series.get(key)
  if (same) return same.name
  const a = norm(author)
  if (!a) return series
  let best: { key: string; name: string } | undefined
  for (const [k, s] of library.series) {
    // two words at least, so a single word ("הארי") does not stand for a series
    if (!s.authors.has(a) || k.split(' ').length < 2) continue
    if ((key.startsWith(`${k} `) || k.startsWith(`${key} `)) && (!best || k.length > best.key.length)) best = { key: k, name: s.name }
  }
  return best?.name ?? series
}

/** A title that opens with its series' name, joined by "ו" or a dash ("פרסי ג'קסון ותקוות האולימפוס" in the series
 *  "פרסי ג'קסון"), without it: "תקוות האולימפוס". Any of the names given may be the one it opens with. */
export function withoutSeries(title: string, ...series: string[]): string {
  const words = title.trim().split(/\s+/)
  for (const name of series) {
    const n = name.trim().split(/\s+/).length
    if (!name.trim() || words.length <= n || norm(words.slice(0, n).join(' ')) !== norm(name)) continue
    const rest = words.slice(n)
    if (/^[-–—:]$/u.test(rest[0]!)) rest.shift()
    else if (/^ו\p{L}{2,}/u.test(rest[0]!)) rest[0] = rest[0]!.slice(1)
    else continue
    if (rest.length && norm(rest.join(' '))) return rest.join(' ')
  }
  return title
}

/** An original title in Hebrew, by the translation service the user agreed to: a short line in Hebrew letters, or
 *  undefined when the service fails or answers with something else. */
async function translatedTitle(title: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const { translateText } = await import('./translate')
    const he = (await translateText(titleCase(title), 'en', 'he', signal)).replace(/["״“”.]/g, '').replace(/\s+/g, ' ').trim()
    return hebrew(he) && !/[A-Za-z]/.test(he) && he.split(' ').length <= 8 ? he : undefined
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn(e)
    return undefined
  }
}

// what each library book's file says of it that other books are compared with: the year it was first published (its
// copyright page), the names its story repeats, and its vocabulary (the series' fingerprint); read once and kept on the
// device, and kept for every book the identification reads, so the fingerprints grow with the library
const FACTS_KEY = 'reader:book-facts'
type Facts = { year: number | null; names?: [string, number][]; words?: [string, number][] }
// read many times for each book identified, so parsed once for as long as the stored text stays the same
let factsRaw: string | null | undefined
let factsParsed: Record<string, Facts> = {}
function facts(): Record<string, Facts> {
  try {
    const raw = localStorage.getItem(FACTS_KEY)
    if (raw !== factsRaw) {
      factsParsed = JSON.parse(raw ?? '{}') as Record<string, Facts>
      factsRaw = raw
    }
    return factsParsed
  } catch {
    return {}
  }
}
/** how many books' vocabulary is kept: the fingerprints' material */
export function fingerprintBooks(): number {
  return Object.values(facts()).filter((f) => f.words?.length).length
}

/** a book's main names: the head of its vocabulary, or the names kept before the vocabulary was */
const namesOf = (f: Facts | undefined) => (f?.words ? f.words.slice(0, 20) : (f?.names ?? []))

function factsFrom(opening: string[], meta?: EpubMeta): Facts {
  // `words` is kept even when empty (a scan, a book with no text of its own), so the book is not read again for it
  return { year: copyrightYear(opening) ?? null, words: meta?.words ?? [] }
}

function keepFactsOf(id: string, f: Facts) {
  try {
    localStorage.setItem(FACTS_KEY, JSON.stringify({ ...facts(), [id]: f }))
  } catch {
    /* storage unavailable */
  }
}

/** keeps what a book the identification just read says of it, for the books compared with it later */
export function keepFacts(id: string, opening: string[], meta?: EpubMeta) {
  if (facts()[id]?.words) return
  keepFactsOf(id, factsFrom(opening, meta))
}

/** a book's facts: those kept, else read from its file (and kept); with `vocabulary`, kept facts from before the
 *  vocabulary was kept are read again */
async function factsOf(m: { id?: string; kind?: string }, signal?: AbortSignal, vocabulary = false): Promise<Facts | undefined> {
  if (!m.id || (m.kind !== 'epub' && m.kind !== 'pdf')) return undefined
  const known = facts()[m.id]
  if (known && (!vocabulary || known.words)) return known
  const { bookDetails } = await import('./bookText')
  const d = await bookDetails({ id: m.id, kind: m.kind }, signal)
  const f = factsFrom(d.opening, d.meta)
  if (d.meta?.lists?.length) rememberLists(d.meta.lists)
  keepFactsOf(m.id, f)
  return f
}

/**
 * The series this book's vocabulary has the fingerprint of (seriesByWords). The author's series in the library are
 * compared (six books of each at most, read when need be); any other series only by the books whose vocabulary is kept
 * already, so a book with no author is compared with the whole library without reading it all. Never this book itself.
 */
async function seriesOfWords(
  words: [string, number][],
  author: string,
  library: LibraryNames,
  self?: string,
  signal?: AbortSignal,
  /** read the author's series' books whose vocabulary is not kept yet; without it, only what is kept is compared */
  read = true,
): Promise<string | undefined> {
  const kept = facts()
  const a = norm(author)
  const mine = (s: { authors: Set<string> }) => !!a && [...s.authors].some((x) => x === a || x.includes(a) || a.includes(x))
  const series = await Promise.all(
    [...library.series.values()]
      // a book with an author is compared only with that author's series (and those of no author known): a world near
      // another author's is not that author's series
      .filter((s) => s.members?.length && (!a || !s.authors.size || mine(s)))
      .map(async (s) => ({
        name: s.name,
        books: (
          await Promise.all(
            s.members!
              .filter((m) => m.id !== self)
              .slice(0, 6)
              .map((m) => (read && mine(s) ? factsOf(m, signal, true) : Promise.resolve(m.id ? kept[m.id] : undefined))),
          )
        ).map((f) => f?.words ?? []),
      })),
  )
  const all = Object.entries(facts())
    .filter(([id]) => id !== self)
    .map(([, f]) => f.words ?? [])
  return seriesByWords(words, series, all)
}

/** The author's series (in the library) that this book's names point to; its books are compared, six of each at most */
async function seriesOfNames(names: [string, number][], author: string, library: LibraryNames, signal?: AbortSignal): Promise<string | undefined> {
  const a = norm(author)
  const mine = [...library.series.values()].filter(
    (s) => s.members?.length && [...s.authors].some((x) => x === a || x.includes(a) || a.includes(x)),
  )
  if (!mine.length) return undefined
  const series = await Promise.all(
    mine.map(async (s) => ({
      name: s.name,
      books: (await Promise.all(s.members!.slice(0, 6).map((m) => factsOf(m, signal)))).map(namesOf).filter((n) => n.length),
    })),
  )
  return seriesByNames(names, series)
}

/** The number a book of this series has, from the numbers its other books in the library have and their years */
async function numberInLibrary(
  series: string,
  year: number | undefined,
  library: LibraryNames,
  signal?: AbortSignal,
  self?: string,
): Promise<number | undefined> {
  const members = (library.series.get(seriesKey(series))?.members ?? []).filter((m) => !self || m.id !== self)
  if (!members.length) return undefined
  const dated = year ? await Promise.all(members.map(async (m) => ({ number: m.number, year: (await factsOf(m, signal))?.year ?? undefined }))) : members
  const n = numberByGaps(dated, year)
  return n
}

/** where a title stands in its series, by what the library has under that title or the lists kept (bookKnowledge) */
function placeOfTitle(title: string, author: string, library?: LibraryNames): { series: string; number: number } | undefined {
  const t = norm(title)
  if (!t) return undefined
  for (const s of library?.series.values() ?? [])
    for (const m of s.members ?? []) if (m.number && m.title && norm(m.title) === t) return { series: s.name, number: m.number }
  const listed = inLists(title, listsOf(author), norm)
  const n = Number(listed?.number)
  return listed?.series && n ? { series: asLibrarySeries(listed.series, author, library), number: n } : undefined
}

/** The place the book's neighbours give it: one after the book it names as the one before, one before the book it names
 *  as the next. Undefined when they name none the library knows, or do not agree. */
function bySequels(meta: EpubMeta | undefined, author: string, library?: LibraryNames): { series: string; number: string } | undefined {
  const places = [
    ...(meta?.prev ?? []).map((t) => placeOfTitle(t, author, library)).map((p) => p && { series: p.series, number: p.number + 1 }),
    ...(meta?.next ?? []).map((t) => placeOfTitle(t, author, library)).map((p) => p && p.number > 1 && { series: p.series, number: p.number - 1 }),
  ].filter((p): p is { series: string; number: number } => !!p)
  const [first] = places
  if (!first || places.some((p) => p.number !== first.number || !sameSeries(p.series, first.series))) return undefined
  return { series: first.series, number: String(first.number) }
}

// ---- weighing: every clue the book gives is checked against the name found, the way a reader would check a guess.
// A name two independent clues agree on, and none speaks against, is sure enough to save without asking; a clue that
// speaks against it keeps it for the user to approve, saying which.

/** where a clue comes from: the file's or library's name, the file's package, the copyright page, a list of the series'
 *  books, the names its story shares with the series, a catalog, the numbers the library leaves free, a running head */
export type Clue = 'name' | 'meta' | 'copyright' | 'list' | 'names' | 'words' | 'sequel' | 'catalog' | 'order' | 'running'

/** two titles that are one: the same words, or one the other's start ("דם האולימפוס" and "דם האולימפוס V") */
function sameTitle(x: string, y: string): boolean {
  const a = norm(x)
  const b = norm(y)
  return !!a && !!b && (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `))
}

/** one series under two spellings or forms: "פרסי ג'קסון" and "פרסי ג'קסון והאולימפיים", "MAGISTERIUM" and "מגיסטריום" */
function sameSeries(x: string, y: string): boolean {
  const a = seriesKey(x)
  const b = seriesKey(y)
  if (!a || !b) return false
  if (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `)) return true
  const s = soundOf(x)
  return s.length >= 4 && s === soundOf(y)
}

/** a clue's say on a series and a number: agree, against, or nothing (it names another series, or none) */
function verdict(r: BookName, series: string, number: string): 'agree' | 'against' | undefined {
  if (!series || !r.series) return undefined
  if (!sameSeries(series, r.series)) return 'against'
  if (!number || !r.number) return number || r.number ? undefined : 'agree'
  return Number(number) === Number(r.number) ? 'agree' : 'against'
}

async function weigh(
  r: Identified,
  b: { title: string; author: string; fileName: string },
  opening: string[],
  meta: EpubMeta | undefined,
  library: LibraryNames | undefined,
  signal?: AbortSignal,
): Promise<Identified> {
  if (!r.series || isJunkTitle(r.title) && !r.number) return r
  const evidence: Clue[] = []
  const conflicts: Clue[] = []
  const count = (c: Clue, v: 'agree' | 'against' | undefined) => {
    if (v === 'agree') evidence.push(c)
    else if (v === 'against') conflicts.push(c)
  }
  // the name the book came with, read as it is
  const named = identifyLocally(b)
  if (named.series) count('name', verdict(r, named.series, named.number))
  if (meta?.series) count('meta', verdict(r, meta.series, meta.number))
  // the copyright page's original series, when it is this series by its sound ("Throne of Glass" is not "כס הזכוכית",
  // which says nothing either way)
  const original = originalSeries(opening)
  if (original && sameSeries(original.series, r.series)) count('copyright', verdict(r, r.series, original.number))
  // a list of the series' books that names this title
  if (!isJunkTitle(r.title)) {
    // only lists printed in books: Wikidata's whole series is a catalog's word (not a second clue beside it), and the
    // names saved in the library may be this book's own
    const listed = inLists(r.title, [...(meta?.lists ?? []), ...listsOf(b.author, [undefined])], norm)
    if (listed) count('list', verdict(r, listed.series || r.series, listed.number))
    // what the books before and after it in the library said of it
    const said = inLists(r.title, listsOf(b.author, ['sequel']), norm)
    if (said) count('sequel', verdict(r, said.series || r.series, said.number))
    const known = !r.online && inLists(r.title, listsOf(b.author, ['wikidata']), norm)
    if (known && verdict(r, known.series, known.number) === 'agree') evidence.push('catalog')
  }
  // the names the story shares with the author's series in the library
  if (meta?.names?.length && library && b.author.trim()) {
    try {
      const s = await seriesOfNames(meta.names, b.author, library, signal)
      if (s) count('names', sameSeries(s, r.series) ? 'agree' : 'against')
    } catch (e) {
      if (signal?.aborted) throw e
    }
  }
  // the books it names as the one before and the next
  const q = bySequels(meta, b.author, library)
  if (q && !evidence.includes('sequel') && !conflicts.includes('sequel')) count('sequel', verdict(r, q.series, q.number))
  // the series' fingerprint in the book's vocabulary: it only agrees (a vocabulary near another series' says too little
  // to speak against)
  if (meta?.words?.length && library) {
    try {
      // only against what is kept: a confirmation is not worth reading the series' books for
      const s = await seriesOfWords(meta.words, b.author, library, (b as { id?: string }).id, signal, false)
      if (s && sameSeries(s, r.series)) evidence.push('words')
    } catch (e) {
      if (signal?.aborted) throw e
    }
  }
  if (r.online && r.sites?.length) evidence.push('catalog')
  // the numbers the library leaves free, and the years: a number the library already has for another book of the series
  // speaks against (unless that book is this one, under the same title)
  const members = library?.series.get(seriesKey(r.series))?.members ?? []
  if (r.number && members.length) {
    // another book at this number: not a second copy of this one (the same title, as a PDF and an EPUB)
    const taken = members.some((m) => m.number && m.number === Number(r.number) && !(m.title && sameTitle(m.title, r.title)))
    if (taken) conflicts.push('order')
  }
  if (meta?.running?.some((h) => norm(h) === norm(r.title))) evidence.push('running')
  // how much each clue counts is what the user's answers taught (identifyLearning): before any, the strong clues count
  // and every clue against blocks
  const stats = clueStats()
  const strong = evidence.filter((c) => trusted(c, stats)).length
  const out: Identified = { ...r, ...(evidence.length && { evidence }), ...(conflicts.length && { conflicts }) }
  if (conflicts.some((c) => blocks(c, stats))) delete out.sure
  else if (strong >= 2) out.sure = true
  return out
}

/** The number in its series that Wikidata gives a book by its original title ("The Nowhere Man" is Orphan X 2): one
 *  work of that very name with a number in a series, else undefined. Wikidata failing gives none. */
async function originalNumber(title: string, holder: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const name = titleCase(title)
    const budget: Budget = { left: 2 }
    const ids = (await wikidataItems(name, 'en', signal, budget)).map((i) => i.title!).slice(0, 8)
    if (!ids.length) return undefined
    // the original's author, from its copyright notice ("Copyright © 2017 by Gregg Hurwitz"), tells two works of one name apart
    const one = onlyOne(await wikidataWorks(ids, name, 'en', signal, budget), holder)
    return one?.work.seriesInfo?.bookDisplayNumber
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn(e)
    return undefined
  }
}

/** A series' book whose title says nothing more than its place: a title that is junk ("8 1~2403") or the series and the
 *  number again ("משפחת קיין 1" as "משפחת קיין והאלים המצריים 1") is none, and a number the title ends with that is the
 *  book's own number ("דם האולימפוס V" as book 5) is left out of it, unless a joining word ties it to the title. */
export function tidyName<T extends BookName>(r: T): T {
  if (!r.series) return r
  let title = r.title.trim()
  // a title that starts with the whole series, then a mark or a number: the series said twice ("מורשת של דיו - בת פלם,
  // חלק ראשון" of the series "מורשת של דיו - בת פלם"; "הבחורים של טומן 4" of the series' book 4). Not one that goes on
  // in words ("הארי פוטר ואבן החכמים")
  const series = r.series.trim()
  if (title.startsWith(series)) {
    const rest = /^\s*(?:[-–—,:]\s*|(\d{1,3})\s*(?:[-–—,:]\s*|$))(.*)$/u.exec(title.slice(series.length))
    if (rest && (!rest[1] || !r.number || Number(rest[1]) === Number(r.number))) {
      title = rest[2]!.trim()
      if (rest[1] && !r.number) r = { ...r, number: String(Number(rest[1])) }
    }
  }
  if (!r.number) return title === r.title ? r : { ...r, title }
  const end = /^(.*?)\s+([IVXLivxl]{1,6}|\d{1,3})$/u.exec(title)
  if (end && bookNumber(end[2]!) === Number(r.number)) {
    const head = end[1]!.trim()
    if (!head || isSeriesName(head, r.series)) title = ''
    else if (!joining(head.split(/\s+/).pop()!)) title = head
  }
  if (isJunkTitle(title) || isSeriesName(title, r.series)) title = ''
  return title === r.title ? r : { ...r, title }
}

/** A name with no title of its own: a title that says nothing, or one that only repeats the series and the number
 *  ("משפחת קיין 1" of "משפחת קיין והאלים המצריים 1"). Its real title is still to be found: in the book, by its
 *  number on Wikidata, by translating the original's. */
function noTitle(r: BookName): boolean {
  return isJunkTitle(r.title) || (!!r.series && !!r.number && !tidyName(r).title)
}

/** a title that is the series' name, or a shorter form of it ("משפחת קיין" of "משפחת קיין והאלים המצריים"), not one that
 *  starts with it ("הארי פוטר ואבן החכמים") */
function isSeriesName(title: string, series: string): boolean {
  const t = seriesKey(title)
  const s = seriesKey(series)
  return !!t && (t === s || s.startsWith(`${t} `))
}
