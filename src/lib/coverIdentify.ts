// The cover, read when nothing else names the book: a book whose name says nothing ("1~2402 1", "5E70B~1") and
// whose own pages did not name it either is identified once more with what OCR reads on its cover — first its lines as
// a title page (the author, the series and its number, the title), then, when they do not make a name, the line in the
// largest letters as the book's title (bySize: the title is set larger than anything else on a cover), looked up like
// any title (the library, the lists, the series that come with the app, the catalogs). OCR runs on the device (see
// ocr.ts), only for these books, and once per book: what was read is kept (`reader:cover-lines`), even when nothing.
import { identifyBook, type Identified, type LibraryNames } from './bookLookup'
import { isJunkTitle, nameFromOpening } from './bookName'
import type { EpubMeta } from './bookText'

const KEY = 'reader:cover-lines'
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

/** whether a name still says nothing of the book: no series, and a title that is no title */
const saysNothing = (r: { series: string; title: string }) => !r.series && isJunkTitle(r.title)

/** the cover's line in the largest letters, then its lines in reading order: read once, then kept */
async function coverLines(b: { id: string; cover?: Blob }, signal?: AbortSignal): Promise<{ largest?: string; lines: string[] }> {
  const known = kept()[b.id] ?? (b.cover ? await read(b.cover, signal) : undefined)
  if (!known) return { lines: [] }
  if (!kept()[b.id]) keep(b.id, known)
  const [largest, ...lines] = known
  return { ...(largest && { largest }), lines }
}

async function read(cover: Blob, signal?: AbortSignal): Promise<string[]> {
  const { ocrLines, bySize, cleanLines } = await import('./ocr')
  const [lines = []] = await ocrLines([cover], signal, (ls) => [bySize(ls)[0] ?? '', ...cleanLines(ls).slice(0, MAX_LINES)])
  return lines
}

/**
 * identifyBook, and when the name it found still says nothing, once more with the cover's lines before the opening
 * pages. The name the cover gives is never sure by itself: it waits for the user like any name read from the book.
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
  const r = await identifyBook(b, online, signal, opening, meta, library)
  if (!saysNothing(r) || (!b.cover && !kept()[b.id])) return r
  let cover: Awaited<ReturnType<typeof coverLines>>
  try {
    cover = await coverLines(b, signal)
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn('OCR of the cover failed', e)
    return r
  }
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
  if (!title || isJunkTitle(title)) return r
  const asTitle = await identifyBook({ ...b, title }, online, signal, opening, meta, library)
  return saysNothing(asTitle) ? r : found(asTitle)
}
