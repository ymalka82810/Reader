// Identifying a book: its series, number, full title and author, read first from what the library has (the title and the
// file name it was added under) and then completed from Google Books, which needs no key. Only the title and author are
// sent, and only after the user agreed (consent 'books').

import { guessBookName, isJunkTitle, nameFromOpening, seriesOf, tidyBookName, withoutAuthor, type BookName } from './bookName'
import { norm } from './sameBook'

export interface Identified extends BookName {
  author: string
  /** whether Google Books found the book; otherwise the result is what the library's own names gave */
  online: boolean
  /** whether the name was read from the book's opening pages rather than from its title or file name */
  fromText?: boolean
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
  const fromTitle = guessBookName(tidyBookName(b.title))
  if (fromTitle.series) return fromTitle
  const fromFile = guessBookName(tidyBookName(withoutAuthor(stem(b.fileName), b.author)))
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
    if (best) return { ...best.name, author: (best.v.authors ?? []).join(', '), online: true }
  }
  return undefined
}

/**
 * The book's name in the template and its author. It is read from the library's names, and when they hold no series or
 * say nothing ("1~2402 1"), from the book's opening lines (`opening`, see lib/bookText). `online` decides whether Google
 * Books is asked, by that name and then by the opening's lines that may be the title: what it finds completes the name (a
 * series, a fuller title, a missing author), but never replaces a series or an author already known. A failed lookup
 * falls back to what was read; only an abort rejects.
 */
export async function identifyBook(
  b: { title: string; author: string; fileName: string },
  online: boolean,
  signal?: AbortSignal,
  opening: string[] = [],
): Promise<Identified> {
  const local = identifyLocally(b)
  const read = opening.length ? nameFromOpening(opening, b.author) : { candidates: [] as string[] }
  // a Hebrew book keeps a Hebrew name, rather than the original's name from its copyright page
  const hebrewBook = hebrew(b.title) || opening.some(hebrew)
  const fromText = !!read.name && (!hebrewBook || hebrew(read.name.title)) && (!local.series || isJunkTitle(local.title))
  const base: BookName = fromText ? read.name! : local
  const mine: Identified = { ...base, author: b.author.trim(), online: false, ...(fromText && { fromText }) }
  if (!online) return mine
  const known = !isJunkTitle(base.title)
  const wants = [...(known ? [base.title] : []), ...read.candidates.filter((c) => norm(c) !== norm(base.title))].slice(0, 4)
  let found: Identified | undefined
  for (const title of wants) {
    try {
      found = await lookupOnline({ title, author: b.author }, signal)
    } catch (e) {
      if (signal?.aborted) throw e
      console.warn(e)
      break
    }
    if (found) break
  }
  if (!found) return mine
  return {
    series: base.series || found.series,
    number: base.series ? base.number : found.number,
    // a fuller title ("הארי פוטר ואבן" -> "הארי פוטר ואבן החכמים"), never a shorter one; any title over one that says nothing
    title: !known || norm(found.title).includes(norm(base.title)) ? found.title : base.title,
    // a Hebrew book keeps a Hebrew author name, rather than the original's "Rick Riordan"
    author: mine.author || (hebrew(found.author) === (known ? hebrew(base.title) : hebrewBook) ? found.author : ''),
    online: true,
  }
}
