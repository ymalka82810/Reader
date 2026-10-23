// One book in the library twice: two files (an EPUB and a PDF of it, two downloads) whose names differed when they
// were added, so the import's check (sameBook, on the names they came with) let both in, and which the identification
// then gave one name. Found from the names the books have now, every time the library changes; merged by keeping the
// copy the user reads and deleting the other's file, with its reading time, its "read" mark and its tags, and its
// notes and place when the two files are of one kind (a position in one file means nothing in the other).
import { sameAuthor } from './authorName'
import { splitBookName } from './bookName'
import { getNotes, mergeBooks, type BookMeta } from './db'
import { confirmName, isConfirmed } from './identifyLearning'
import { norm } from './sameBook'

type Book = Pick<BookMeta, 'id' | 'title' | 'author' | 'kind'> & Partial<Pick<BookMeta, 'fromPdf' | 'addedAt' | 'fraction' | 'lastOpened'>>

/** with no author on one side, a title this short is too common to call two books one */
const MIN_TITLE_WITHOUT_AUTHOR = 8

const authorsAgree = (a: string, b: string) => {
  const x = norm(a)
  const y = norm(b)
  return !x || !y || x === y || x.includes(y) || y.includes(x) || sameAuthor(a, b)
}

/** whether two books of the library are one book, by the names they have now */
export function sameCopy(a: Book, b: Book): boolean {
  if (a.id === b.id || (a.kind !== 'epub' && a.kind !== 'pdf') || (b.kind !== 'epub' && b.kind !== 'pdf')) return false
  const x = splitBookName(a.title)
  const y = splitBookName(b.title)
  const tx = norm(x.title)
  const ty = norm(y.title)
  if (!tx || tx !== ty) return false
  // two series, or two numbers of one series, that share a book title are two books
  if (x.series && y.series && (norm(x.series) !== norm(y.series) || Number.parseInt(x.number) !== Number.parseInt(y.number))) return false
  if (!authorsAgree(a.author, b.author)) return false
  return (!!norm(a.author) && !!norm(b.author)) || tx.length >= MIN_TITLE_WITHOUT_AUTHOR || (!!x.series && !!y.series)
}

const NOT_COPIES_KEY = 'reader:not-copies'
const pairKey = (a: string, b: string) => [a, b].sort().join('|')

function notCopies(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOT_COPIES_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

/** the user said these books are not one: they are not offered again */
export function markNotCopies(groups: { id: string }[][]) {
  const kept = notCopies()
  for (const g of groups) for (const a of g) for (const b of g) if (a.id < b.id) kept.add(pairKey(a.id, b.id))
  try {
    localStorage.setItem(NOT_COPIES_KEY, JSON.stringify([...kept]))
  } catch {
    /* storage unavailable */
  }
}

/** the library's books that are there more than once, each group one book, but for those the user said are not */
export function copyGroups<T extends Book>(books: T[]): T[][] {
  const not = notCopies()
  const groups: T[][] = []
  for (const b of books) {
    const g = groups.find((g) => g.some((o) => sameCopy(o, b) && !not.has(pairKey(o.id, b.id))))
    if (g) g.push(b)
    else groups.push([b])
  }
  return groups.filter((g) => g.length > 1)
}

/**
 * The copy to keep: the one the user reads (with notes, then further along), then an EPUB of its own over one made
 * from a PDF over a PDF, then the one whose name the user approved, then the first added.
 */
export async function keeperOf<T extends Book>(group: T[]): Promise<T> {
  const notes = new Map(await Promise.all(group.map(async (b) => [b.id, (await getNotes(b.id).catch(() => [])).length] as const)))
  const kind = (b: Book) => (b.kind === 'epub' ? (b.fromPdf ? 1 : 2) : 0)
  const rank = (b: T) => [Number((notes.get(b.id) ?? 0) > 0), b.fraction ?? 0, kind(b), Number(isConfirmed(b.id, b.title)), -(b.addedAt ?? 0)]
  return [...group].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i]! - ra[i]!
    return 0
  })[0]!
}

/** Merges every group into its keeper (keeperOf); the name the user approved on a dropped copy, when the keeper's
 *  was not, goes with it. Returns how many files were deleted. */
export async function mergeCopies(groups: Book[][]): Promise<number> {
  let dropped = 0
  for (const g of groups) {
    const keep = await keeperOf(g)
    const approved = isConfirmed(keep.id, keep.title) ? undefined : g.find((b) => b.id !== keep.id && isConfirmed(b.id, b.title))
    const name = approved && { title: approved.title, author: approved.author }
    for (const b of g) {
      if (b.id === keep.id) continue
      await mergeBooks(keep.id, b.id, name)
      dropped++
    }
    if (name) confirmName(keep.id, name.title, name.author)
  }
  return dropped
}
