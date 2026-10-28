// Identifying a book: its series, number, full title and author, read first from what the library has (the title and the
// file name it was added under), the EPUB's own package and the opening pages, and then completed from the catalogs online,
// none of which needs a key: Google Books first, by the book's ISBN, which names the edition exactly, then by its title;
// Open Library the same way when Google Books found nothing or did not answer; and Wikidata for the series and its number
// when the name still has no series. Only the ISBN, the title and the author are sent, and only after the user agreed
// (consent 'books').

import { authorByDash, authorFromOpening, formatBookName, authorInName, guessBookName, isJunkTitle, nameFromOpening, people, personShaped, seriesOf, splitBookName, tidyBookName, unglued, withoutAuthor, type BookName } from './bookName'
import { libraryAuthor, realAuthor, tidyAuthor } from './authorName'
import type { EpubMeta } from './bookText'
import type { Clue } from './clues'
import { bookNumber, copyrightYear, seriesByWords, inLists, librarySeriesFor, numberByGaps, numberByRhythm, numberedByRhythm, rhythmVerdict, yearsVerdict, type KnownSeries, originalSeries, originalSeriesName, originalTitle, seriesByNames, soundOf, titleCase } from './bookInference'
import { listsOf, rememberLists } from './bookKnowledge'
import { makeVerdict } from './fileMake'
import { authorByTimeline, timelineVerdict, type Dated } from './authorTimeline'
import { debutVerdict, designVerdict, houseOf, houseVerdict, jointVerdict, lengthVerdict, placeSeries, type Placed } from './seriesLinks'
import { bundledLists, bundledSeries, bundledTitle, loadSeriesDb } from './seriesDb'
import { hasConsent } from './consent'
import { blocks, clueStats, confirmedIds, needsMoreProof, sources, trusted } from './identifyLearning'
import { modelAllows } from './identifyModel'
import { bookIsbns } from './isbn'
import { readLines, type LineContext } from './lineModel'
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
  /** the library's books the name leaned on (their numbers, years and words placed it) */
  leaned?: string[]
  /** the best other reading of the book, too near this name for it to be saved without asking (the second hypothesis) */
  rival?: string
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
  series: Map<string, { name: string; authors: Set<string>; members?: { number: number; id?: string; kind?: string; title?: string; words?: number }[] }>
  /** the series each titled book of a series is in, by its title */
  titles?: Map<string, string>
  /** longest first, so "ג'ורג' ר ר מרטין" is tried before "מרטין" */
  authors: string[]
  /** each book with an id: its author and series ('' for none), for what the author's books say together (the timeline) */
  books?: { id: string; author: string; series: string }[]
}

/** a name with no series that is saved as the book named after its series ("שומרת הערים האבודות 1"; splitBookName):
 *  that series, its first book */
function savedFirst(n: BookName): BookName {
  if (n.series) return n
  const saved = splitBookName(n.title)
  return saved.series ? saved : n
}

/** a series compared across spellings: "פרויקט איקס" is "פרויקט X" */
const seriesKey = (s: string) => norm(s.replace(/איקס/gu, 'x'))

export function libraryNames(books: { title: string; author?: string; id?: string; kind?: string; words?: number }[]): LibraryNames {
  const series: LibraryNames['series'] = new Map()
  const titles = new Map<string, string>()
  const spellings = new Map<string, Map<string, number>>()
  const authors = new Set<string>()
  const all: NonNullable<LibraryNames['books']> = []
  for (const b of books) {
    const a = (b.author ?? '').trim()
    if (a && !/@/.test(a)) authors.add(a)
    // as the identification reads it, so "פרויקט X #01 - פרויקט X" counts before it is renamed
    const guess = savedFirst(unjoined(guessBookName(tidyBookName(b.title))))
    if (b.id) all.push({ id: b.id, author: /@/.test(a) ? '' : a, series: guess.series })
    const name = guess.series
    const key = name && seriesKey(name)
    if (!key) continue
    const entry = series.get(key) ?? { name, authors: new Set<string>(), members: [] }
    if (a) entry.authors.add(norm(a))
    if (norm(guess.title)) titles.set(norm(guess.title), name)
    // a book of the series with no number counts too (as 0): the years may order it
    const n = Number(guess.number) || 0
    if (Number.isInteger(n) && n >= 0)
      entry.members!.push({ number: n, title: guess.title, ...(b.id && { id: b.id }), ...(b.kind && { kind: b.kind }), ...(b.words && { words: b.words }) })
    series.set(key, entry)
    const count = spellings.get(key) ?? new Map<string, number>()
    count.set(name, (count.get(name) ?? 0) + 1)
    spellings.set(key, count)
  }
  // a book named only after a series of the library ("שומרת הערים האבודות" by the author of "שומרת הערים האבודות 2 -
  // גלות"): that series' book named after it, its number still open (0)
  for (const b of books) {
    const guess = unjoined(guessBookName(tidyBookName(b.title)))
    const entry = !guess.series ? series.get(seriesKey(guess.title)) : undefined
    const a = norm(b.author ?? '')
    if (!entry || (a && !/@/.test(a) && entry.authors.size && !entry.authors.has(a))) continue
    if (b.id && entry.members!.some((m) => m.id === b.id)) continue
    entry.members!.push({ number: 0, title: guess.title, ...(b.id && { id: b.id }), ...(b.kind && { kind: b.kind }), ...(b.words && { words: b.words }) })
    const mine = b.id ? all.find((x) => x.id === b.id) : undefined
    if (mine) mine.series = entry.name
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
  // a side that "A - B" names share, where the other side differs from book to book, is their author ("סטפני מאייר - מולד
  // הירח", "סטפני מאייר - ליקוי חמה"): two words alike in shape cannot be told apart by one name, but the books of one author can
  const sides = new Map<string, { name: string; others: Set<string> }>()
  for (const b of books) {
    if ((b.author ?? '').trim()) continue
    const t = tidyBookName(b.title)
    if (guessBookName(t).series) continue
    const parts = t.split(/\s+[-–—]\s+/u)
    if (parts.length !== 2) continue
    for (const [x, y] of [[parts[0]!, parts[1]!], [parts[1]!, parts[0]!]] as const) {
      const e = sides.get(norm(x)) ?? { name: x, others: new Set<string>() }
      e.others.add(norm(y))
      sides.set(norm(x), e)
    }
  }
  for (const e of sides.values()) if (e.others.size >= 2 && personShaped(e.name)) authors.add(e.name)
  // the spelling most of the series' books have
  for (const [key, count] of spellings) series.get(key)!.name = [...count].sort((x, y) => y[1] - x[1])[0]![0]
  return { series, titles, authors: [...authors].sort((x, y) => y.length - x.length), books: all }
}

/** The series and number a file's name gives a book whose own title has neither (see findName). Words compared as norm
 *  does; the series has to be two letters or more and no joining word, and the number one to three digits. */
export function seriesInFileName(fileStem: string, title: string, author = ''): { series: string; number: string; title: string } | undefined {
  const words = (x: string) => tidyBookName(x.replace(/_+/g, ' ')).replace(/\([^)]*\)/gu, ' ').split(/\s+/u).filter((w) => /[\p{L}\d]/u.test(w))
  const f = words(fileStem)
  // a Roman numeral after the title is the series' number again ("דם האולימפוס V"): the title is the words before it
  const roman = /\s+[IVX]{1,5}$/u.test(title.trim())
  if (roman) title = title.trim().replace(/\s+[IVX]{1,5}$/u, '')
  const t = words(title)
  if (!t.length || f.length <= t.length) return undefined
  const n = (w: string) => norm(w)
  const at = (i: number) => t.every((w, k) => n(f[i + k] ?? '') === n(w))
  const series = (ws: string[]) => {
    const name = ws.join(' ').replace(/[-–—:,]+$/u, '').trim()
    return /\p{L}{2}/u.test(name) && !joining(name) && !/^(?:ה?חלק|ה?כרך|ה?ספר|ה?פרק|part|vol\.?|volume|book)$/iu.test(name) ? name : ''
  }
  const num = (w?: string) => (w && /^#?\d{1,3}$/.test(w) ? String(Number(w.replace('#', ''))) : '')
  for (let i = 0; i + t.length <= f.length; i++) {
    if (!at(i)) continue
    // "בני קרטר 1 לשנוא אותו …"
    const a0 = new Set(words(author).map(n))
    const before = f.slice(0, i).filter((w) => !/^[-–—]$/.test(w))
    // the author between the number and the title ("מדריך העצלה לקסם 1 הלן הרפר מכשפה עצלנית")
    while (before.length > 2 && a0.has(n(before[before.length - 1]!))) before.pop()
    const nb = num(before[before.length - 1])
    if (nb && series(before.slice(0, -1))) return { series: series(before.slice(0, -1)), number: nb, title }
    // "כובע מלא שמיים … עולם הדיסק 32"
    const after = f.slice(i + t.length).filter((w) => !/^[-–—]$/.test(w))
    const na = num(after[after.length - 1])
    if (!before.length && na && after.length >= 2) {
      // the words right before the number that are not the author's
      const tail = after.slice(0, -1)
      const a = new Set(words(author).map(n))
      const own = tail.filter((w) => !a.has(n(w)))
      if (own.length && own.length <= 4 && series(own)) return { series: series(own), number: na, title }
    }
    // "גורלו של אפולו 3 המבוך הבוער ריק ריירדן": the book's title is the series, the words after the number its title
    if (i === 0) {
      const nx = num(f[t.length])
      const rest = f.slice(t.length + 1)
      const a = new Set(words(author).map(n))
      while (rest.length && a.has(n(rest[rest.length - 1]!))) rest.pop()
      if (nx && rest.length && series(t)) return { series: series(t), number: nx, title: rest.join(' ') }
    }
  }
  return undefined
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
  // a name that is a whole series the library has, alone or with a number ("שומרת הערים האבודות", "שומרת הערים
  // האבודות 1" when the library has "שומרת הערים האבודות 2 - גלות"), also said twice ("שומרת הערים האבודות - שומרת
  // הערים האבודות"): the book of that series the series is named after, or the one at that number. Not a series of
  // another author: a book of one's own may share another series' name
  const twice = /^(.+?)\s+[-–—]\s+(.+)$/u.exec(title)
  const bare = /^(.+?)(?:\s+(?:#\s*)?(\d{1,3})|\s*\((\d{1,3})\))?$/u.exec(twice && seriesKey(twice[1]!) === seriesKey(twice[2]!) ? twice[1]! : title)
  const whole = bare ? lib.series.get(seriesKey(bare[1]!)) : undefined
  if (bare && whole && whole.members?.length && (!who || !whole.authors.size || whole.authors.has(norm(who)))) {
    const n = bare[2] ?? bare[3]
    // the series and 1 alone is how the book named after the series is saved (formatBookName): its title is the series'
    return { name: { series: whole.name, number: n ? String(Number(n)) : '', title: !n || Number(n) === 1 ? bare[1]! : '' }, author: who, sure: false }
  }
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
/** what the line classifier is told besides the lines: the book's own author and title (when it says something), and the
 *  library's authors and series */
function linesContext(b: { title: string; author: string }, library?: LibraryNames): LineContext {
  const own = identifyLocally({ ...b, fileName: '' }).title
  return {
    author: b.author,
    ...(!isJunkTitle(own) && { title: own }),
    ...(library && { authors: library.authors, series: [...library.series.values()].map((e) => e.name) }),
  }
}

/** The line classifier's reading of the book's lines. When the cover is read as a title page (identifyWithCover puts its
 *  lines before the pages), its lines are read as the cover's, beside the pages and checked against them, rather than
 *  as more lines of the pages: the cover sets the title large on one book and the author on another, and the title page
 *  tells which is which. */
function readLinesOf(b: { title: string; author: string }, opening: string[], meta: EpubMeta | undefined, library?: LibraryNames) {
  const cover = meta?.cover
  const onCover = new Set([...(cover?.largest ? [cover.largest] : []), ...(cover?.lines ?? [])])
  const asPage = !!cover && opening.some((l) => onCover.has(l))
  const pages = asPage ? opening.filter((l) => !onCover.has(l)) : opening
  const hebrewBook = hebrew(b.title) || opening.some(hebrew)
  return readLines(pages, { ...linesContext(b, library), ...(asPage && { cover }) }, hebrewBook)
}

export async function identifyBook(
  b: { title: string; author: string; fileName: string },
  online: boolean,
  signal?: AbortSignal,
  opening: string[] = [],
  meta?: EpubMeta,
  /** the library's series and authors (libraryNames), which split a name that has no dash */
  library?: LibraryNames,
): Promise<Identified> {
  await loadSeriesDb()
  const r = tidyName(await findName(b, online, signal, opening, meta, library))
  const weighed = await weigh(r, b, opening, meta, library, signal)
  // a catalog's spelling of an author the library has under another ("Rick Riordan", "ריק ריירדן")
  const author = library && weighed.author ? libraryAuthor(weighed.author, library.authors) : undefined
  if (author) return { ...weighed, author }
  // no author still: the one author of the library whose years, publisher and translator the book shares (the author's
  // timeline); it is only offered, never saved without asking
  const fitting = !weighed.author && library ? byTimeline(opening, library, (b as { id?: string }).id) : undefined
  if (!fitting) return weighed
  const { sure: _sure, ...rest } = weighed
  return { ...rest, author: fitting, evidence: [...new Set([...(weighed.evidence ?? []), 'timeline' as const])] }
}

/** the author the book's year and house fit among the library's authors (authorTimeline's authorByTimeline), by what is
 *  kept of their books (never read for it) */
function byTimeline(opening: string[], library: LibraryNames, self?: string): string | undefined {
  const house = houseOf(opening)
  if (!house.length) return undefined
  const kept = facts()
  const by = new Map<string, { author: string; works: { year?: number; house: string[] }[] }>()
  for (const x of library.books ?? []) {
    const f = x.id !== self && x.author ? kept[x.id] : undefined
    if (!f?.house?.length) continue
    const k = norm(x.author)
    const e = by.get(k) ?? { author: x.author, works: [] }
    e.works.push({ ...(f.year && { year: f.year }), house: f.house })
    by.set(k, e)
  }
  return authorByTimeline(copyrightYear(opening), house, [...by.values()])
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
  const given =
    (/@/.test(b.author) ? '' : tidyAuthor(b.author)) ||
    authorInName(b.title) ||
    authorInName(stem(b.fileName)) ||
    // a plain "author - title" name: told apart by the library's authors, then by the shape of a person's name
    realAuthor(authorByDash(b.title, library?.authors)) ||
    realAuthor(authorByDash(stem(b.fileName), library?.authors)) ||
    // the name printed by the title on the title page, with the book's own title or the one read from the page
    (opening.length ? authorFromOpening(opening, identifyLocally(b).title) || authorFromOpening(opening, nameFromOpening(opening, '').name?.title ?? '') || '' : '') ||
    // and when the rules read none: the line the line classifier tags as the author (lineModel)
    (opening.length ? (readLinesOf(b, opening, meta, library).author ?? '') : '')
  // the name the library has for the same author ("J.K. Rowling" when its books are by "ג'יי קיי רולינג")
  const author = (library && libraryAuthor(given, library.authors)) || given
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
  const original = !base.series ? originalSeries(opening) : undefined
  // the library's series first, then the series that come with the app ("MAGISTERIUM" is "מגיסטריום" there too)
  const fromSeries =
    original &&
    ((library && librarySeriesFor(original.series, b.author, library.series.values(), norm)) || librarySeriesFor(original.series, b.author, bundledSeries(), norm))
  // the original series with no number ("MAGISTERIUM" alone), as the library names it
  const nameOnly =
    !base.series && !fromSeries && library ? originalSeriesName([...opening, ...(meta?.running ?? [])], b.author, library.series.values(), norm) : undefined
  let fromOriginal = !!fromSeries || !!nameOnly
  if (fromSeries)
    base = { series: fromSeries, number: original!.number, title: isJunkTitle(base.title) ? (bundledTitle(fromSeries, original!.number) ?? '') : base.title }
  else if (nameOnly) base = { series: nameOnly, number: '', title: isJunkTitle(base.title) ? '' : base.title }
  // a number put into the middle of a title ("הארי פוטר 1 ואבן החכמים"): the title without it, when a list names that title
  // at that very number (a list that agrees with the number is the evidence; no title is guessed from the number alone)
  if (!base.series && !base.number && !/\s[-–—]\s/u.test(base.title)) {
    const mid = /^(.+?)\s+#?(\d{1,3})\s+(\S.*)$/u.exec(base.title)
    if (mid) {
      const plain = `${mid[1]} ${mid[3]}`
      const hit = inLists(plain, [...(meta?.lists ?? []), ...listsOf(b.author, undefined, plain)], norm)
      if (hit?.series && Number(hit.number) === Number(mid[2]))
        base = { series: asLibrarySeries(hit.series, b.author, library), number: String(Number(hit.number)), title: plain }
    }
  }
  // the file's name says the series and number the book's own title leaves out ("בני קרטר 1 לשנוא אותו - קלואי וולש.epub"
  // for "לשנוא אותו", "כובע מלא שמיים (טרי פראצט) עולם הדיסק 32"): the title found in the file's name, with a series and a
  // number right before it or at the end; or the title as the series before a number ("גורלו של אפולו 3 המבוך הבוער")
  if (!base.number && !noTitle(base)) {
    const named = seriesInFileName(stem(b.fileName), base.title, b.author)
    // a series the name already has is only given its number, never another series
    if (named && (!base.series || sameTitle(seriesKey(base.series), seriesKey(named.series)))) base = { series: base.series || asLibrarySeries(named.series, b.author, library), number: named.number, title: named.title }
  }
  // a list of the series' books that names this title, printed in this book or in another one read before
  if (meta?.lists?.length) rememberLists(meta.lists, b.author)
  if (!base.number && !isJunkTitle(base.title)) {
    const listed = inLists(base.title, [...(meta?.lists ?? []), ...listsOf(b.author, undefined, base.title)], norm)
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
    const n =
      (await numberInLibrary(base.series, copyrightYear(opening), library, b.author, signal, self.id)) ??
      numberByJoint(base.series, base.title, opening, meta, library, b.author, self.id, (b as { words?: number }).words)
    if (n) {
      // the number is given: the next book of this run is not offered it too
      const me = entry?.members?.find((m) => self.id && m.id === self.id)
      if (me) me.number = n
      else entry?.members?.push({ number: n, title: base.title })
      base = { ...base, number: String(n) }
      fromOriginal = true
    }
  }
  // still no number, for the book named after its series: the first, the book the series took its name from, unless the
  // library already has another first book of the series (then it may be a collection of the whole series)
  if (base.series && !base.number && namedAfterSeries(base.title, base)) {
    const self = (b as { id?: string }).id
    const firsts = (library?.series.get(seriesKey(base.series))?.members ?? []).filter((m) => m.number === 1 && (!self || m.id !== self))
    if (!firsts.some((m) => !namedAfterSeries(m.title ?? '', base))) {
      base = { ...base, number: '1' }
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
  // still no title: the line the line classifier tags as the title (lineModel), with its series when it tags one and the
  // name has none. What the hand-written rules above read always comes first; this reads the title page they left unread
  let fromLines = false
  if (noTitle(base) && opening.length) {
    const lined = readLinesOf(b, opening, meta, library)
    if (lined.title) {
      base = base.series ? { ...base, title: lined.title } : { series: lined.series ?? '', number: lined.series ? (lined.number ?? '') : '', title: lined.title }
      fromLines = true
    }
  }
  const libSure = !!lib?.sure && base === local
  const mine: Identified = {
    ...base,
    author: b.author.trim(),
    online: false,
    ...(fromText || fromOriginal || fromRunning || fromLines ? { fromText: true } : fromMeta && { fromMeta, ...(metaSure && { sure: true }) }),
    ...(libSure && { sure: true }),
    ...(numberedOnline && { sites: [SITE.wikidata] }),
  }
  if (!online) return mine
  const known = !isJunkTitle(base.title)
  // a book whose name already has a series, a title and an author has nothing to ask Google Books about
  if (known && base.series && b.author.trim() && !noTitle(base)) return mine
  // our own identification comes first: a real title with its author is an answer, and the catalogs that limit the requests
  // (Google Books, Open Library) are asked only for the book it did not name. Wikidata, which has no such limit, still
  // completes the series.
  // (a book that prints its ISBN is still asked: that answer is exact)
  // (a title the line classifier read is still asked about: the catalog confirms it and gives its series)
  if (known && b.author.trim() && !noTitle(base) && !fromLines && !bookIsbns([...(meta?.identifiers ?? []), ...opening], hebrewBook).length)
    return withWikidata(mine, hebrewBook, signal, library)
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
    // nothing; the catalog's title for a book found by its ISBN, which is that very book; and over a title the line
    // classifier read, which was only its best guess at the line (the catalog was asked with that line)
    title: !known || fromLines || thisBook || norm(found.title).includes(norm(base.title)) ? found.title : base.title,
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
/** `n`: the number the book itself gives (its package, its copyright page, its title page), null when none; a book
 *  read before it was kept has none, and is read again for it */
type Facts = {
  year: number | null
  n?: number | null
  names?: [string, number][]
  words?: [string, number][]
  /** who made the edition: its translator, publisher and ISBN block (seriesLinks' houseOf); a book kept before has none */
  house?: string[]
  /** its cover's print (seriesLinks' coverPrint) */
  print?: string
  /** how its file was made (fileMake); a book kept before has none */
  make?: string[]
}
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
  return {
    year: copyrightYear(opening) ?? null,
    n: ownNumber(opening, meta) ?? null,
    words: meta?.words ?? [],
    house: houseOf(opening),
    make: meta?.make ?? [],
    ...(meta?.print && { print: meta.print }),
  }
}

/** The number a book gives itself, whatever its name says: its package's (calibre's series index), its copyright
 *  page's original series ("MAGISTERIUM V"), or its title page ("ספר שלישי", "הספר השלישי בסדרה") */
function ownNumber(opening: string[], meta?: EpubMeta): number | undefined {
  const read = (x?: string) => (x ? bookNumber(/^\d+/.exec(x.trim())?.[0] ?? x.trim()) : undefined)
  try {
    return read(meta?.number) ?? read(originalSeries(opening)?.number) ?? (opening.length ? read(nameFromOpening(opening, '').name?.number) : undefined)
  } catch {
    return undefined
  }
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
  const known = facts()[id]
  if (known?.words && known.house && known.make) return
  // a book kept before its house or its make was: only what is new is added
  keepFactsOf(id, known?.words ? { ...known, house: houseOf(opening), make: meta?.make ?? [] } : factsFrom(opening, meta))
}

/** keeps a book's cover print (read with its cover, see coverIdentify), for the books compared with it later */
export function keepPrint(id: string, print: string) {
  const known = facts()[id]
  if (known?.print === print) return
  keepFactsOf(id, { ...(known ?? { year: null }), print })
}

/** the cover print kept for a book */
export function keptPrint(id: string): string | undefined {
  return facts()[id]?.print
}

/** a book's facts: those kept, else read from its file (and kept); with `vocabulary`, kept facts from before the
 *  vocabulary was kept are read again */
async function factsOf(m: { id?: string; kind?: string }, signal?: AbortSignal, vocabulary = false): Promise<Facts | undefined> {
  if (!m.id || (m.kind !== 'epub' && m.kind !== 'pdf')) return undefined
  const known = facts()[m.id]
  // a book kept before its own number was: read again, once
  if (known && (!vocabulary || known.words) && known.n !== undefined && known.house && known.make) return known
  let d: Awaited<ReturnType<typeof import('./bookText').bookDetails>>
  try {
    const { bookDetails } = await import('./bookText')
    d = await bookDetails({ id: m.id, kind: m.kind }, signal)
  } catch (e) {
    // a book that cannot be read again keeps what was kept of it
    if (signal?.aborted || !known) throw e
    return known
  }
  const fresh = factsFrom(d.opening, d.meta)
  // what was kept before stays where the new reading has nothing (a book read again only for its own number)
  const f: Facts = known
    ? {
        ...known,
        year: fresh.year ?? known.year,
        n: fresh.n,
        house: fresh.house,
        make: fresh.make,
        // a book kept with its names (and no vocabulary yet) keeps them: an empty vocabulary would hide them
        words: fresh.words?.length ? fresh.words : known.words !== undefined ? known.words : known.names ? undefined : fresh.words,
      }
    : fresh
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

/** What the catalogs know of a series: how many books it has and the year each was first published — the series
 *  database that comes with the app, and Wikidata's lists kept on the device */
function knownSeries(series: string, author: string): KnownSeries {
  const lists = [...bundledLists(author), ...listsOf(author, ['wikidata'])].filter((l) => l.series && sameSeries(l.series, series))
  if (!lists.length) return {}
  const numbers = lists.flatMap((l) => l.books.map((b) => Number(b.number))).filter((n) => Number.isInteger(n) && n > 0)
  const years = new Map<number, number>()
  for (const l of lists)
    for (const b of l.books) {
      const n = Number(b.number)
      if (b.year && n > 0 && !(years.get(n)! <= b.year)) years.set(n, b.year)
    }
  return { ...(numbers.length && { total: Math.max(...numbers) }), ...(years.size && { years }) }
}

/** the same author, across spellings and the forms a credit gives ("ריק ריירדן" in "ריק ריירדן ומרק אוסטר") */
const sameWriter = (x: string, y: string) => {
  const a = norm(x)
  const b = norm(y)
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
}

/** The author's books with their years (the timeline's material): the library's (by the years kept of them, never read
 *  for it), and the books of the author's series the catalogs date. Each in its series, named `series` when it is that
 *  one. Never the book itself. */
function authorWorks(author: string, series: string, self: string | undefined, library?: LibraryNames): Dated[] {
  const kept = facts()
  const of = (s: string) => (s && series && sameSeries(s, series) ? series : s ? seriesKey(s) : '')
  const out: Dated[] = []
  for (const x of library?.books ?? []) {
    const year = x.id !== self && sameWriter(x.author, author) ? kept[x.id]?.year : undefined
    if (year) out.push({ year, series: of(x.series) })
  }
  for (const l of [...bundledLists(author), ...listsOf(author, ['wikidata'])])
    for (const w of l.books) if (w.year) out.push({ year: w.year, series: of(l.series ?? '') })
  return out
}

/** The years of the series' books in the library, read once from their copyright pages and kept */
async function datedMembers(series: string, library: LibraryNames, signal?: AbortSignal, self?: string) {
  const members = (library.series.get(seriesKey(series))?.members ?? []).filter((m) => !self || m.id !== self)
  // a book of the series the library has with no number in its name, whose own pages give one, counts with that one
  return Promise.all(
    members.map(async (m) => {
      const f = await factsOf(m, signal)
      return { number: m.number || f?.n || 0, title: m.title, year: f?.year ?? undefined }
    }),
  )
}

/** The number a book of this series has, from the years: the catalog's for the series' books, and the library's books
 *  of it with their numbers and years */
async function numberInLibrary(
  series: string,
  year: number | undefined,
  library: LibraryNames,
  author: string,
  signal?: AbortSignal,
  self?: string,
): Promise<number | undefined> {
  if (!year) return undefined
  const known = knownSeries(series, author)
  const members = await datedMembers(series, library, signal, self)
  if (!members.length && !known.years) return undefined
  // the books whose number a run of years gives (numberedByRhythm) count as numbered; and when the years leave it open,
  // the series' pace (numberByRhythm)
  const paced = numberedByRhythm(members)
  return numberByGaps(paced, year, known) ?? numberByRhythm(paced, year)
}

/**
 * The number the whole series gives a book with none, when the years alone did not: every book of the series the library
 * has placed together with this one, by all their clues at once (seriesLinks' placeSeries) — the number each gives
 * itself, the lists, the years and the order their words first appear in. Only a number no book of the library holds,
 * and only by a clear margin; it waits for the user's approval.
 */
function numberByJoint(
  series: string,
  title: string,
  opening: string[],
  meta: EpubMeta | undefined,
  library: LibraryNames,
  author: string,
  self?: string,
  /** the book's length in words */
  length?: number,
): number | undefined {
  const members = (library.series.get(seriesKey(series))?.members ?? []).filter((m) => m.id && m.id !== self && !(m.title && sameTitle(m.title, title)))
  if (members.length < 2) return undefined
  const kept = facts()
  const anchors = confirmedIds()
  const lists = [...(meta?.lists ?? []), ...listsOf(author, [undefined, 'wikidata'], title)]
  const listedOf = (t?: string) => {
    const l = t && !isJunkTitle(t) ? inLists(t, lists, norm) : undefined
    return l && (!l.series || sameSeries(l.series, series)) ? Number(l.number) || undefined : undefined
  }
  const placed: Placed[] = members.map((m) => {
    const f = kept[m.id!]
    return {
      id: m.id!,
      ...(m.number && { number: m.number }),
      ...(anchors.has(m.id!) && { anchored: true }),
      ...(f?.year && { year: f.year }),
      ...(f?.n && { own: f.n }),
      ...(listedOf(m.title) && { listed: listedOf(m.title) }),
      ...(f?.words?.length && { words: f.words.map(([w]) => w) }),
      ...(m.words && { length: m.words }),
    }
  })
  const me = '\u0000self'
  const year = copyrightYear(opening)
  const listed = listedOf(title)
  const words = (meta?.words ?? []).map(([w]) => w)
  placed.push({ id: me, ...(year && { year }), ...(listed && { listed }), ...(words.length && { words }), ...(length && { length }) })
  const known = knownSeries(series, author)
  const p = placeSeries(placed, me, known)
  if (!p?.number || p.margin < 2 || members.some((m) => m.number === p.number)) return undefined
  // as with the years: never a number after the last the library has, unless the series is known to reach it (a book
  // the library lacks may come before)
  const last = Math.max(0, ...members.map((m) => m.number || 0))
  return p.number < last || p.number <= (known.total ?? 0) ? p.number : undefined
}

/** where a title stands in its series, by what the library has under that title or the lists kept (bookKnowledge) */
function placeOfTitle(title: string, author: string, library?: LibraryNames): { series: string; number: number } | undefined {
  const t = norm(title)
  if (!t) return undefined
  for (const s of library?.series.values() ?? [])
    for (const m of s.members ?? []) if (m.number && m.title && norm(m.title) === t) return { series: s.name, number: m.number }
  const listed = inLists(title, listsOf(author, undefined, title), norm)
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

export type { Clue } from './clues'

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

/** what every clue the book gives says of a name: the clues that agree, those that speak against, the book's own
 *  sources that agree with its title and author (crossCheck: shown, but never making it sure), and the library's books
 *  the name leaned on */
type Said = { agreed: Clue[]; against: Clue[]; shown: Clue[]; leaned: Set<string> }

async function cluesOf(
  r: Identified,
  b: { title: string; author: string; fileName: string },
  opening: string[],
  meta: EpubMeta | undefined,
  library: LibraryNames | undefined,
  signal?: AbortSignal,
): Promise<Said> {
  const evidence: Clue[] = []
  const conflicts: Clue[] = []
  const count = (c: Clue, v: 'agree' | 'against' | undefined) => {
    if (v === 'agree') evidence.push(c)
    else if (v === 'against') conflicts.push(c)
  }
  // the name the book came with, read as it is
  const named = identifyLocally(b)
  // the library's books the name leaned on (their numbers, years and words placed it): a correction of one of them has
  // this name gone over again (identifyLearning's dependents)
  const leaned = new Set<string>()
  // the series and its number: only a book that has one
  if (r.series) {
    let saidOf: 'agree' | 'against' | undefined
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
      // what the books before and after it in the library said of it (weighed with what it says of them, below)
      const said = inLists(r.title, listsOf(b.author, ['sequel']), norm)
      if (said) saidOf = verdict(r, said.series || r.series, said.number)
      // only for a title the book gave: a title taken from the list by its number (seriesDb's bundledTitle) is the list's
      // own word, and agrees with it by itself
      const given = [named.title, meta?.title, ...(meta?.running ?? []), ...opening].some((x) => !!x && norm(x) === norm(r.title))
      const known = !r.online && given && inLists(r.title, listsOf(b.author, ['wikidata'], r.title), norm)
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
    const saysOf = q ? verdict(r, q.series, q.number) : undefined
    // a link both sides say (the book before names this one as the next, and this one names it as the one before) is a
    // strong clue; one only the one side says is a weak one; either side against speaks against
    if (saidOf === 'against' || saysOf === 'against') conflicts.push('sequel')
    else if (saidOf === 'agree' && saysOf === 'agree') evidence.push('sequel')
    else if (saidOf === 'agree' || saysOf === 'agree') evidence.push('neighbour')
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
      // another book at this number: not this very book (by its id: its title in the library may be another, or the new
      // name may have none), nor a second copy of it (the same title, as a PDF and an EPUB)
      const self = (b as { id?: string }).id
      const taken = members.some(
        (m) => m.number && m.number === Number(r.number) && !(self && m.id === self) && !(m.title && sameTitle(m.title, r.title)),
      )
      if (taken) conflicts.push('order')
    }
    // the years: the book's first publication against those of the series' books before and after it (the library's, and
    // the catalog's for the numbers it dates); a clue of its own, so how often it is right is measured
    const year = copyrightYear(opening)
    if (r.number && year) {
      const self = (b as { id?: string }).id
      const kept = facts()
      const dated = members
        .filter((m) => m.number && !(self && m.id === self) && !(m.title && sameTitle(m.title, r.title)))
        .map((m) => ({ number: m.number || (m.id && kept[m.id]?.n) || 0, year: (m.id && kept[m.id]?.year) || undefined }))
      const paced = numberedByRhythm(dated)
      const catalog = [...(knownSeries(r.series, r.author || b.author).years ?? [])].filter(([n]) => n !== Number(r.number)).map(([n, y]) => ({ number: n, year: y }))
      count('years', yearsVerdict([...paced, ...catalog], Number(r.number), year))
      // the series' pace, against the number found (read in the book, or by any other way): the two cross-checked
      count('rhythm', rhythmVerdict(paced, Number(r.number), year))
    }
    // what the series' books share beyond their names, and the whole series placed at once (seriesLinks)
    if (members.length) {
      const self = (b as { id?: string }).id
      const kept = facts()
      const others = members.filter((m) => !(self && m.id === self) && !(m.title && sameTitle(m.title, r.title)))
      const own = (id?: string) => (id ? kept[id] : undefined)
      // the house: the translator, the publisher or the ISBN block most of the series' books share (it only agrees)
      const house = houseOf(opening)
      if (house.length) {
        const all = Object.values(kept).map((f) => f.house ?? [])
        if (houseVerdict(house, others.map((m) => own(m.id)?.house ?? []), all) === 'agree') evidence.push('house')
      }
      // the file's make: what the series' files share that is rare in the library (it only agrees)
      if (meta?.make?.length) {
        const all = Object.entries(kept).filter(([id]) => id !== self).map(([, f]) => f.make ?? [])
        if (makeVerdict(meta.make, others.map((m) => own(m.id)?.make ?? []), all) === 'agree') evidence.push('make')
      }
      // the cover's design, nearer the series' covers than nearly all the library's (it only agrees)
      if (meta?.print) {
        const ids = new Set(members.map((m) => m.id))
        const mine = others.map((m) => own(m.id)?.print).filter((x): x is string => !!x)
        const rest = Object.entries(kept)
          .filter(([id, f]) => f.print && !ids.has(id) && id !== self)
          .map(([, f]) => f.print!)
        if (designVerdict(meta.print, mine, rest) === 'agree') evidence.push('design')
      }
      if (r.number) {
        const numbered = others.map((m) => ({ id: m.id, number: m.number || own(m.id)?.n || 0, words: (own(m.id)?.words ?? []).map(([w]) => w) }))
        const words = (meta?.words ?? []).map(([w]) => w)
        // the order the series' words first appear in (it only agrees: a prequel is out of order on purpose)
        if (words.length && debutVerdict(numbered, words, Number(r.number)) === 'agree') evidence.push('debut')
        // the whole series placed at once: this book and the rest of the series' books, every clue of each together
        const anchors = confirmedIds()
        const titled = [...(meta?.lists ?? []), ...listsOf(b.author, [undefined, 'wikidata'], r.title)]
        const listedOf = (t?: string) => {
          const l = t && !isJunkTitle(t) ? inLists(t, titled, norm) : undefined
          return l && (!l.series || sameSeries(l.series, r.series)) ? Number(l.number) || undefined : undefined
        }
        const placed: Placed[] = others
          .filter((m) => m.id)
          .map((m) => ({
            id: m.id!,
            ...(m.number && { number: m.number }),
            ...(anchors.has(m.id!) && { anchored: true }),
            ...(own(m.id)?.year && { year: own(m.id)!.year! }),
            ...(own(m.id)?.n && { own: own(m.id)!.n! }),
            ...(listedOf(m.title) && { listed: listedOf(m.title) }),
            ...(own(m.id)?.words?.length && { words: own(m.id)!.words!.map(([w]) => w) }),
            ...(m.words && { length: m.words }),
          }))
        const me = '\u0000self'
        const year = copyrightYear(opening)
        const n = ownNumber(opening, meta)
        const listed = listedOf(r.title)
        const length = (b as { words?: number }).words
        placed.push({ id: me, ...(year && { year }), ...(n && { own: n }), ...(listed && { listed }), ...(words.length && { words }), ...(length && { length }) })
        // the length along the series, where it follows the order here (it only agrees)
        if (lengthVerdict(others.map((m) => ({ number: m.number || own(m.id)?.n || 0, words: m.words ?? 0 })), Number(r.number), length) === 'agree') evidence.push('length')
        if (placed.length >= 2) count('joint', jointVerdict(placed, me, Number(r.number), knownSeries(r.series, r.author || b.author)))
        for (const m of placed) if (m.id !== me) leaned.add(m.id)
      }
    }
  }
  // the author's timeline: the book's year against the years the author wrote in, and wrote this series in (a weak clue
  // against, see authorTimeline)
  const year = copyrightYear(opening)
  const author = r.author || b.author
  if (year && author.trim()) count('timeline', timelineVerdict(authorWorks(author, r.series, (b as { id?: string }).id, library), year, r.series ? r.series : ''))
  // the title and the author, for every book: each source the book has, on its own (crossCheck). What they agree on is
  // shown with the name but makes nothing sure (two of them are often one source twice: a file named after its package);
  // what speaks against keeps the name from being saved without asking
  const shown: Clue[] = []
  for (const [c, v] of crossCheck(r, named, opening, meta)) {
    if (v === 'against') conflicts.push(c)
    else shown.push(c)
  }

  if (meta?.running?.some((h) => norm(h) === norm(r.title))) evidence.push('running')
  return { agreed: [...new Set(evidence)], against: [...new Set(conflicts)], shown, leaned }
}

/** the sources that agree with a name and count toward a sure one: only the series' clues, each trusted by what the
 *  user's answers taught, and the clues of one source (the file's name and its package, say) once */
const strength = (said: Said, stats = clueStats()) => sources(said.agreed.filter((c) => trusted(c, stats)), stats)

async function weigh(
  r: Identified,
  b: { title: string; author: string; fileName: string },
  opening: string[],
  meta: EpubMeta | undefined,
  library: LibraryNames | undefined,
  signal?: AbortSignal,
): Promise<Identified> {
  if (isJunkTitle(r.title) && !r.number) return r
  const said = await cluesOf(r, b, opening, meta, library, signal)
  const { agreed, against, shown, leaned } = said
  // how much each clue counts is what the user's answers taught (identifyLearning): before any, the strong clues count
  // and every clue against blocks
  const stats = clueStats()
  // a sure name needs independent sources that agree
  const strong = strength(said, stats)
  const all = [...new Set([...agreed, ...shown])]
  const out: Identified = {
    ...r,
    ...(all.length && { evidence: all }),
    ...(against.length && { conflicts: against }),
    ...(leaned.size && { leaned: [...leaned] }),
  }
  if (against.some((c) => blocks(c, stats))) delete out.sure
  // and once it has learnt enough from the user's answers, the model that weighs all the clues together must trust it too
  else if (strong >= (needsMoreProof() ? 3 : 2) && modelAllows(all, against)) out.sure = true
  // the second hypothesis: the best other reading of the book, weighed by the same clues. A name is saved by itself only
  // when it is far ahead of it (RIVAL_GAP sources), since clues that agree with it may agree as well with the other
  if (out.sure) {
    const rival = await secondHypothesis(r, b, opening, meta, library, signal, strong, shown, stats)
    if (rival) {
      delete out.sure
      out.rival = formatBookName(rival)
    }
  }
  return out
}

/** how many more agreeing sources a name needs than the best other reading of the book to be saved without asking */
const RIVAL_GAP = 2

/**
 * The other readings of the book its own sources give, beside the name found: another series (the file's name, the
 * package, the copyright page, a list, the story's names or vocabulary), another number in the series (any source that
 * numbers it), and for a book of no series another title (the package's, the file's name's, the cover's). The best of
 * them by the same clues, when the name is not far enough ahead of it; else undefined.
 */
async function secondHypothesis(
  r: Identified,
  b: { title: string; author: string; fileName: string },
  opening: string[],
  meta: EpubMeta | undefined,
  library: LibraryNames | undefined,
  signal: AbortSignal | undefined,
  strong: number,
  shown: Clue[],
  stats: ReturnType<typeof clueStats>,
): Promise<BookName | undefined> {
  const named = identifyLocally(b)
  const rivals: BookName[] = []
  const add = (x: BookName) => {
    if (!x.series && !x.title) return
    if (rivals.some((y) => norm(y.series) === norm(x.series) && Number(y.number || 0) === Number(x.number || 0) && norm(y.title) === norm(x.title))) return
    rivals.push(x)
  }
  if (r.series) {
    const original = originalSeries(opening)
    const listed = !isJunkTitle(r.title) ? inLists(r.title, [...(meta?.lists ?? []), ...listsOf(b.author, [undefined])], norm) : undefined
    const read: { series?: string; number?: string }[] = [
      { series: named.series, number: named.number },
      { series: meta?.series, number: meta?.number },
      // the copyright page's original series only as a series the library has under its own name (\"Throne of Glass\" is
      // most often this very series, in its original language)
      ...(original && library ? [{ series: librarySeriesFor(original.series, b.author, library.series.values(), norm), number: original.number }] : []),
      ...(listed ? [{ series: listed.series || r.series, number: listed.number }] : []),
      { series: r.series, number: String(ownNumber(opening, meta) ?? '') },
    ]
    try {
      if (meta?.names?.length && library && b.author.trim()) read.push({ series: await seriesOfNames(meta.names, b.author, library, signal) })
      if (meta?.words?.length && library) read.push({ series: await seriesOfWords(meta.words, b.author, library, (b as { id?: string }).id, signal, false) })
    } catch (e) {
      if (signal?.aborted) throw e
    }
    for (const x of read) {
      if (!x.series) continue
      const series = sameSeries(x.series, r.series) ? r.series : x.series
      const number = x.number || ''
      // the same place is no other reading; a series given with no number is the same series and its number
      if (series === r.series && (!number || Number(number) === Number(r.number))) continue
      add({ series, number, title: r.title })
    }
  } else {
    // a book of no series: another title its own sources give (not a shorter or longer form of this one)
    const near = (x: string) => {
      const a = norm(x)
      const t = norm(r.title)
      return !a || a.includes(t) || t.includes(a)
    }
    for (const x of [meta?.title, named.title, meta?.cover?.largest]) if (x && !isJunkTitle(x) && !near(x)) add({ series: '', number: '', title: x })
  }
  let best: { name: BookName; gap: number } | undefined
  for (const x of rivals.slice(0, 6)) {
    let gap: number
    if (r.series) {
      const said = await cluesOf({ ...r, ...x }, b, opening, meta, library, signal)
      const theirs = strength(said, stats)
      // a reading no clue gives a source of its own is no rival
      if (!theirs) continue
      gap = strong - theirs
    } else {
      // a title: what the book's own sources say of each (crossCheck), as many sources for the other as for this one
      const mine = new Set(shown).size
      const theirs = new Set(crossCheck({ ...r, ...x }, named, opening, meta).filter(([, v]) => v === 'agree').map(([c]) => c)).size
      if (!theirs) continue
      gap = mine - theirs
    }
    if (gap < RIVAL_GAP && (!best || gap < best.gap)) best = { name: x, gap }
  }
  return best?.name
}

/**
 * What each of the book's own sources says of the name found: the title and the author, each source on its own, so that
 * they are compared with one another rather than taken one after the other. The book's package (`meta`) agrees or speaks
 * against; the title page (`page`), the cover's lines (`cover`, read by OCR: it may misread, so it only agrees) and the
 * file's name (`name`, which often holds more than the title) only agree, since a line they lack proves nothing.
 */
export function crossCheck(
  r: { series: string; number?: string; title: string; author: string },
  named: { title: string },
  opening: string[],
  meta: EpubMeta | undefined,
): [Clue, 'agree' | 'against'][] {
  const out: [Clue, 'agree' | 'against'][] = []
  const title = norm(r.title)
  if (!title || isJunkTitle(r.title)) return out
  // one title holds the other ("דם האולימפוס V", "הסיכון - אוניברסיטת בראייר 2"), or the series and number name it
  const sameT = (x?: string) => {
    const n = norm(x ?? '')
    return !!n && (n === title || n.includes(title) || (title.includes(n) && n.length >= 3))
  }
  // one name in two spellings: the letters that only stand for vowels (א ו י ה) left out, "לורה" and "לאורה" are one
  const bare = (x: string) => people(x).replace(/(?<=\p{L})[אויה](?=\p{L})/gu, '')
  const author = people(r.author)
  const sameA = (x?: string) =>
    !!author && !!x && (people(x) === author || people(x).includes(author) || author.includes(people(x)) || bare(x) === bare(r.author))
  const lineHas = (lines: readonly string[], f: (l: string) => boolean) => lines.slice(0, 40).some(f)
  // the package: an EPUB's own title and authors
  // a package's title that is the book's series ("גורלו של אפולו" for its third book) says nothing against the title
  const isSeries = (x: string) => !!r.series && (norm(x) === norm(r.series) || norm(x).startsWith(`${norm(r.series)} `))
  if (meta?.title && !isJunkTitle(meta.title)) out.push(['meta', sameT(meta.title) || isSeries(meta.title) ? 'agree' : 'against'])
  const authors = (meta?.authors ?? []).filter((a) => a && !/@/.test(a))
  if (author && authors.length) out.push(['meta', authors.some(sameA) ? 'agree' : 'against'])
  // the title page and the copyright page
  if (lineHas(opening, (l) => norm(l) === title)) out.push(['page', 'agree'])
  if (author && lineHas(opening, (l) => sameA(l) && people(l).length <= author.length + 12)) out.push(['page', 'agree'])
  // the cover, as OCR read it
  const cover = [...(meta?.cover?.largest ? [meta.cover.largest] : []), ...(meta?.cover?.lines ?? [])]
  if (cover.length && (lineHas(cover, (l) => norm(l) === title) || sameT(meta?.cover?.largest))) out.push(['cover', 'agree'])
  if (author && lineHas(cover, (l) => sameA(l) && people(l).length <= author.length + 12)) out.push(['cover', 'agree'])
  // the file's name
  if (named.title && !isJunkTitle(named.title) && sameT(named.title)) out.push(['name', 'agree'])
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
  // the first book of a series may be named after it, the series having taken its name from that book ("שומרת הערים
  // האבודות" 1 of the series "שומרת הערים האבודות"): its title, the series' whole name, is its own. Only the first book
  // or one with no number yet; a later book named only after its series names nothing of its own
  if (namedAfterSeries(title, r)) return title === r.title ? r : { ...r, title }
  title = unglued(title, series)
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

/** a title that is the series' whole name (not a shorter form of it), of the series' first book or of one with no number:
 *  the book the series is named after (see tidyName) */
function namedAfterSeries(title: string, r: { series: string; number: string }): boolean {
  const t = seriesKey(title)
  return !!t && t === seriesKey(r.series) && (!r.number.trim() || bookNumber(r.number.trim().split(/\s+/)[0]!) === 1)
}

/** a title that is the series' name, or a shorter form of it ("משפחת קיין" of "משפחת קיין והאלים המצריים"), not one that
 *  starts with it ("הארי פוטר ואבן החכמים") */
function isSeriesName(title: string, series: string): boolean {
  const t = seriesKey(title)
  const s = seriesKey(series)
  return !!t && (t === s || s.startsWith(`${t} `))
}
