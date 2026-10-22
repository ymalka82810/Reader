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
  const found = (x: Identified): Identified => ({ ...x, fromText: true, sure: undefined, evidence: [...(x.evidence ?? []), 'cover'] })
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
