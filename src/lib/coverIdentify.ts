// The cover, read when nothing else names the book: a book whose name says nothing ("1~2402 1", "5E70B~1") and
// whose own pages did not name it either is identified once more with what OCR reads on its cover — first its lines as
// a title page (the author, the series and its number, the title), then, when they do not make a name, the line in the
// largest letters as the book's title (bySize: the title is set larger than anything else on a cover), looked up like
// any title (the library, the lists, the series that come with the app, the catalogs). OCR runs on the device (see
// ocr.ts), only for these books, and once per book: what was read is kept (`reader:cover-lines`), even when nothing.
import { identifyBook, keepPrint, keptPrint, tidyName, type Identified, type LibraryNames } from './bookLookup'
import { coverPrint } from './seriesLinks'
import { withoutCredits } from './nameCredits'
import { authorFromCover, isJunkTitle, nameFromOpening, splitGlued } from './bookName'
import { libraryAuthor } from './authorName'
import type { EpubMeta } from './bookText'

// "2": a cover read as nothing before is read again, once
const KEY = 'reader:cover-lines2'
const MAX_LINES = 8
const KEEP = 400

function kept(): Record<string, string[]> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return v && typeof v === 'object' ? (v as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

function keep(id: string, lines: string[]) {
  try {
    const all = { ...kept(), [id]: lines }
    const ids = Object.keys(all)
    for (const old of ids.slice(0, Math.max(0, ids.length - KEEP))) delete all[old]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* storage unavailable: read again next time */
  }
}

const PART_WORD = String.raw`(?:[א-י]|ראשון|שני|שלישי|רביעי|חמישי)`
// run on to a word, only the first letters: "חלקי" or "חלקה" end ordinary words
const GLUED_PART_WORD = String.raw`(?:[א-ד]|ראשון|שני|שלישי|רביעי|חמישי)`

/** The volume a cover line or a file name says: "חלק ב" -> "ב'". In a file name the words are run together
 *  ("…הלוחמתחלקב"), so the word for a part may be the end of a word there. */
function partOf(lines: string[], glued = false): string | undefined {
  for (const l of lines) {
    const m = (glued ? new RegExp(String.raw`חלק\s*(${GLUED_PART_WORD})['׳]?(?=\s+\d|\s*$)`, 'u') : new RegExp(String.raw`^ה?חלק\s+(${PART_WORD})['׳]?$`, 'u')).exec(l.trim())
    if (m) return m[1]!.length === 1 ? `${m[1]}'` : m[1]
  }
  return undefined
}

/** the title with its volume, unless it already says which ("סופת החרבות, חלק ראשון") */
function withPart(title: string, part: string | undefined): string {
  return part && title && !/(?:^|\s)ה?(?:חלק|כרך|ספר)(?:\s|$)/u.test(title) ? `${title}, חלק ${part}` : title
}

/** whether a name still says nothing of the book: a title that is no title (a series with no number does not help: the
 *  series may be the title run together, "הלביאה הלוחמת - הלביאההלוחמתחלקא") */
const saysNothing = (r: { series: string; number?: string; title: string }) => isJunkTitle(r.title) && !(r.series && r.number)

/** the cover's line in the largest letters, then its lines in reading order: read once, then kept */
async function coverLines(b: { id: string; cover?: Blob }, signal?: AbortSignal): Promise<{ largest?: string; lines: string[] }> {
  const known = kept()[b.id] ?? (b.cover ? await read(b.cover, signal) : undefined)
  if (!known) return { lines: [] }
  // a cover that read as nothing is read again next time, not kept as nothing
  if (!kept()[b.id] && known.some(Boolean)) keep(b.id, known)
  const [largest, ...lines] = known
  return { ...(largest && { largest }), lines }
}

async function read(cover: Blob, signal?: AbortSignal): Promise<string[]> {
  const { ocrLines, bySize, cleanLines } = await import('./ocr')
  const [lines = []] = await ocrLines([cover], signal, (ls) => [bySize(ls)[0] ?? '', ...cleanLines(ls).slice(0, MAX_LINES)])
  return lines
}

/**
 * identifyBook with the cover's lines as a source of their own (crossCheck), and when the name it found still says
 * nothing, once more with them before the opening pages. The name the cover gives is never sure by itself: it waits for the user like any name read from the book.
 * A cover that cannot be read (no cover, OCR unavailable) leaves the first answer as it is.
 */
export async function identifyWithCover(
  b: { id: string; title: string; author: string; fileName: string; cover?: Blob },
  online: boolean,
  signal: AbortSignal | undefined,
  opening: string[],
  meta: EpubMeta | undefined,
  library?: LibraryNames,
): Promise<Identified> {
  // whatever way the name was found, the author, the publisher and the year it carries are taken out of it last
  const r = await identifyAll(b, online, signal, opening, meta, library)
  return tidyName(withoutCredits(r, b.author))
}

async function identifyAll(
  b: { id: string; title: string; author: string; fileName: string; cover?: Blob },
  online: boolean,
  signal: AbortSignal | undefined,
  opening: string[],
  meta: EpubMeta | undefined,
  library?: LibraryNames,
): Promise<Identified> {
  // every book's cover is read (once: what was read is kept) and is one more source the weighing compares with the others
  let read: Awaited<ReturnType<typeof coverLines>> | undefined
  if (b.cover || kept()[b.id]) {
    try {
      read = await coverLines(b, signal)
    } catch (e) {
      if (signal?.aborted) throw e
      console.warn('OCR of the cover failed', e)
    }
  }
  // the cover's print (its layout and colours), once per book: what the covers of its series share
  let print = keptPrint(b.id)
  if (!print && b.cover) {
    print = await coverPrint(b.cover)
    if (print) keepPrint(b.id, print)
  }
  const empty: EpubMeta = { title: '', authors: [], series: '', number: '', identifiers: [] }
  const withLines: EpubMeta | undefined = read && (read.largest || read.lines.length) ? { ...(meta ?? empty), cover: read } : meta
  const withCover: EpubMeta | undefined = print ? { ...(withLines ?? empty), print } : withLines
  const r = await identifyBook(b, online, signal, opening, withCover, library)
  if (!read) return r
  // a name with no author: the author the cover prints, when it prints one (waits for the user like any name read from the book)
  if (!saysNothing(r)) {
    if (r.author) return r
    try {
      const lines = read.lines
      const printed = authorFromCover(lines, r.title, library?.authors)
      const author = printed && ((library && libraryAuthor(printed, library.authors)) || printed)
      return author ? { ...r, author, fromText: true, sure: undefined, evidence: [...(r.evidence ?? []), 'cover'] } : r
    } catch (e) {
      if (signal?.aborted) throw e
      return r
    }
  }
  const cover = read
  // the volume the cover or the file name says ("חלק ב"): a title of its own that has none is the same for both volumes
  const part = partOf(cover.lines) ?? partOf([b.title.replace(/_+/g, ' ')], true)
  const found = (x: Identified): Identified => ({
    ...x,
    title: withPart(x.title, part),
    fromText: true,
    sure: undefined,
    evidence: [...(x.evidence ?? []), 'cover'],
  })
  // lines the opening already has (an EPUB of pictures reads its cover there) say nothing new
  const fresh = cover.lines.filter((l) => !opening.includes(l))
  if (fresh.length) {
    const asPage = await identifyBook(b, online, signal, [...fresh, ...opening], meta, library)
    if (!saysNothing(asPage)) return found(asPage)
  }
  // the largest line as the title, when it is one: not the author, a credit, an address or a sentence
  const title = cover.largest && nameFromOpening([cover.largest], b.author).candidates[0]
  if (title && !isJunkTitle(title)) {
    const asTitle = await identifyBook({ ...b, title }, online, signal, opening, meta, library)
    if (!saysNothing(asTitle)) return found(asTitle)
  }
  // still nothing: the file name's run-together letters, split into words that the book, its cover or the library use
  const split = splitGlued(r.title.replace(/(?:^|(?<=\p{L}))חלק\s*(?:[א-ד]|ראשון|שני|שלישי|רביעי|חמישי)$/u, ''), vocabulary(opening, cover, library))
  if (!split) return r
  const asSplit = await identifyBook({ ...b, title: split }, online, signal, opening, meta, library)
  return saysNothing(asSplit) ? { ...r, title: withPart(split, part) } : { ...found(asSplit), fromText: undefined }
}

/** the words the book's opening, its cover and the library's names and authors use: what a run-together name is split by */
function vocabulary(opening: string[], cover: { largest?: string; lines: string[] }, library?: LibraryNames): Set<string> {
  const words = new Set<string>()
  const add = (line: string) => {
    for (const w of line.split(/[^\p{L}]+/u)) if (w.length >= 2) words.add(w)
  }
  for (const l of [...opening, ...(cover.largest ? [cover.largest] : []), ...cover.lines]) add(l)
  if (library) {
    for (const a of library.authors) add(a)
    for (const [title, series] of library.titles ?? []) {
      add(title)
      add(series)
    }
    for (const e of library.series.values()) {
      add(e.name)
      for (const m of e.members ?? []) if (m.title) add(m.title)
    }
  }
  return words
}
