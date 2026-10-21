// Identifying a book: its series, number, full title and author, read first from what the library has (the title and the
// file name it was added under), the EPUB's own package and the opening pages, and then completed from Google Books, which
// needs no key: first by the book's ISBN, which names the edition exactly, then by its title. Only the ISBN, the title and
// the author are sent, and only after the user agreed (consent 'books').

import { authorInName, guessBookName, isJunkTitle, splitBookName, nameFromOpening, seriesOf, tidyBookName, withoutAuthor, type BookName } from './bookName'
import type { EpubMeta } from './bookText'
import { bookIsbns } from './isbn'
import { norm } from './sameBook'

export interface Identified extends BookName {
  author: string
  /** whether Google Books found the book; otherwise the result is what the library's own names gave */
  online: boolean
  /** whether the name was read from the book's opening pages rather than from its title or file name */
  fromText?: boolean
  /** whether the series (or the title) came from the EPUB's package rather than from the book's names */
  fromMeta?: boolean
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

async function search(q: string, signal?: AbortSignal): Promise<VolumeInfo[]> {
  const params = new URLSearchParams({
    q,
    maxResults: '20',
    printType: 'books',
    fields: 'items(volumeInfo(title,subtitle,authors,language,seriesInfo))',
  })
  const res = await fetch(`${API}?${params}`, { signal })
  if (!res.ok) throw new Error(`Google Books answered ${res.status}`)
  const data = (await res.json()) as { items?: { volumeInfo?: VolumeInfo }[] }
  return (data.items ?? []).map((i) => i.volumeInfo ?? {})
}

/** Google Books' entry for an ISBN; undefined when there is none, or when a Hebrew book's ISBN is the original's (a
 *  translation's copyright page names it too) and the entry is not in Hebrew. Rejects when the network or the service fails. */
async function lookupIsbn(isbn: string, hebrewBook: boolean, signal?: AbortSignal): Promise<Identified | undefined> {
  const v = (await search(`isbn:${isbn}`, signal)).find((x) => norm(x.title ?? ''))
  if (!v || (hebrewBook && !hebrew(v.title ?? ''))) return undefined
  return { ...nameOf(v), author: (v.authors ?? []).join(', '), online: true, sure: true }
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

export function libraryNames(books: { title: string; author?: string }[]): LibraryNames {
  const series = new Map<string, { name: string; authors: Set<string> }>()
  const authors = new Set<string>()
  for (const b of books) {
    const a = (b.author ?? '').trim()
    if (a && !/@/.test(a)) authors.add(a)
    const name = splitBookName(b.title).series
    if (!name || !norm(name)) continue
    const entry = series.get(norm(name)) ?? { name, authors: new Set<string>() }
    if (a) entry.authors.add(norm(a))
    series.set(norm(name), entry)
  }
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
  if (!lib || name.series) return undefined
  let title = name.title
  let who = author
  if (!who)
    for (const a of lib.authors) {
      const t = withoutAuthor(title, a)
      if (t !== title && norm(t)) {
        title = t
        who = a
        break
      }
    }
  const m = MIDDLE.exec(title)
  const known = m ? lib.series.get(norm(m[1]!)) : undefined
  if (m && known) {
    const sure = !!who && known.authors.has(norm(who))
    return { name: { series: known.name, number: String(Number(m[2])), title: m[3]! }, author: who, sure }
  }
  return title !== name.title ? { name: { ...name, title }, author: who, sure: false } : undefined
}

/** Google Books asked about a name with its number in the middle, as the series and the title around the number: the
 *  title with the series in it ("הארי פוטר ואבן החכמים"), then the title alone. Taken only when the catalog's entry
 *  names both: the title, and the series in its title or its series. */
async function lookupSplit(series: string, number: string, rest: string, author: string, signal?: AbortSignal): Promise<Identified | undefined> {
  for (const title of [`${series} ${rest}`, rest]) {
    const f = await lookupOnline({ title, author }, signal)
    if (!f) continue
    const t = norm(f.title)
    if (!t.includes(norm(rest)) || !(t.includes(norm(series)) || norm(f.series).includes(norm(series)))) continue
    return { ...f, series: f.series || series, number: f.series ? f.number : String(Number(number)) }
  }
  return undefined
}

const quoted = (s: string) => `"${s.replace(/"/g, ' ').trim()}"`

/** Google Books' best match for a title (and author, when known); undefined when nothing fits.
 *  Rejects when the network or the service fails. */
export async function lookupOnline(want: { title: string; author: string }, signal?: AbortSignal): Promise<Identified | undefined> {
  if (!norm(want.title)) return undefined
  const queries = want.author.trim()
    ? [`intitle:${quoted(want.title)} inauthor:${quoted(want.author)}`, `intitle:${quoted(want.title)}`]
    : [`intitle:${quoted(want.title)}`]
  for (const q of queries) {
    let best: { s: number; v: VolumeInfo; name: BookName } | undefined
    for (const v of await search(q, signal)) {
      const name = nameOf(v)
      const s = score(v, name, want)
      if (s && (!best || s > best.s)) best = { s, v, name }
    }
    // the same title (4) by the same author (3): no doubt left about which book it is
    if (best) return { ...best.name, author: (best.v.authors ?? []).join(', '), online: true, ...(best.s >= 7 && { sure: true }) }
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
  const isbns = bookIsbns([...(meta?.identifiers ?? []), ...opening], hebrewBook).slice(0, 3)
  const wants = [...(known ? [base.title] : []), ...read.candidates.filter((c) => norm(c) !== norm(base.title))].slice(0, 4)
  const middle = !base.series ? MIDDLE.exec(base.title) : null
  // each ask, and whether what it finds is this very book (so the catalog's title is taken over the library's)
  const asks: [() => Promise<Identified | undefined>, boolean][] = [
    ...isbns.map((isbn): [() => Promise<Identified | undefined>, boolean] => [() => lookupIsbn(isbn, hebrewBook, signal), true]),
    ...(middle ? [[() => lookupSplit(middle[1]!, middle[2]!, middle[3]!, b.author, signal), true] as [() => Promise<Identified | undefined>, boolean]] : []),
    ...wants.map((title): [() => Promise<Identified | undefined>, boolean] => [() => lookupOnline({ title, author: b.author }, signal), false]),
  ]
  let found: Identified | undefined
  let thisBook = false
  for (const [ask, exact] of asks) {
    try {
      found = await ask()
    } catch (e) {
      if (signal?.aborted) throw e
      console.warn(e)
      break
    }
    if (found) {
      thisBook = exact
      break
    }
  }
  if (!found) return mine
  const sure = found.sure || (metaSure && !fromText) || libSure
  return {
    ...(sure && { sure }),
    series: base.series || found.series,
    number: base.series ? base.number : found.number,
    // a fuller title ("הארי פוטר ואבן" -> "הארי פוטר ואבן החכמים"), never a shorter one; any title over one that says
    // nothing; and the catalog's title for a book found by its ISBN, which is that very book
    title: !known || thisBook || norm(found.title).includes(norm(base.title)) ? found.title : base.title,
    // a Hebrew book keeps a Hebrew author name, rather than the original's "Rick Riordan"
    author: mine.author || (hebrew(found.author) === (known ? hebrew(base.title) : hebrewBook) ? found.author : ''),
    online: true,
  }
}
