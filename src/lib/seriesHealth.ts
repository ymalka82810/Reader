// The library's check-up: what in the names of its books is almost always an identification's mistake. Two different
// books with one number in a series; a series whose books are by authors who are not one; one author under several
// spellings, which splits the author's books between folders (the folder is the author); and the numbers a series is
// missing, which may be books not in the library yet, or a book numbered wrong. Read from the names alone, on the device.
import { sameAuthor } from './authorName'
import { soundOf } from './bookInference'
import { splitBookName } from './bookName'
import { norm } from './sameBook'

type Book = { id: string; title: string; author: string }

export type Issue =
  /** one author under several spellings: `main` is the one most of the books have */
  | { kind: 'author'; main: string; others: string[]; books: number }
  /** different books with the same number of a series */
  | { kind: 'duplicate'; series: string; number: number; books: Book[] }
  /** a series whose books are by different authors */
  | { kind: 'authors'; series: string; authors: string[]; books: Book[] }
  /** the numbers a series has none of, up to its last */
  | { kind: 'gap'; series: string; missing: number[] }
  /** one series under several spellings ("מגיסטריום" / "Magisterium"): `main` is the one most of the books have, and
   *  `books` the books of the others */
  | { kind: 'series'; main: string; others: string[]; books: Book[] }

/** one author: the same by its sound, or one name holding the other ("הולי בלק" in "הולי בלק וקסנדרה קלייר") */
const oneAuthor = (a: string, b: string) => sameAuthor(a, b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a))

/** the authors grouped by who they are, each group the spellings with how many books have each, most first */
function authorGroups(books: Book[], same: (a: string, b: string) => boolean): [string, number][][] {
  const count = new Map<string, number>()
  for (const b of books) {
    const a = b.author.trim()
    if (a && !/@/.test(a)) count.set(a, (count.get(a) ?? 0) + 1)
  }
  const groups: [string, number][][] = []
  for (const entry of [...count].sort((x, y) => y[1] - x[1])) {
    const g = groups.find((g) => g.some(([a]) => same(a, entry[0])))
    if (g) g.push(entry)
    else groups.push([entry])
  }
  return groups
}

export function libraryHealth(books: Book[]): Issue[] {
  const issues: Issue[] = []
  // spellings of one author: by sound only, since one name in another (a co-author) is not a spelling of it
  for (const g of authorGroups(books, sameAuthor)) {
    const spellings = g.filter(([a]) => norm(a) !== norm(g[0]![0]))
    if (spellings.length) issues.push({ kind: 'author', main: g[0]![0], others: spellings.map(([a]) => a), books: g.reduce((n, [, c]) => n + c, 0) })
  }
  const series = new Map<string, { name: string; books: (Book & { number: number; name: string })[] }>()
  for (const b of books) {
    const n = splitBookName(b.title)
    if (!n.series) continue
    const key = norm(n.series)
    const s = series.get(key) ?? { name: n.series, books: [] }
    s.books.push({ ...b, number: Number(/^\d+/.exec(n.number)?.[0] ?? 0), name: n.title })
    series.set(key, s)
  }
  for (const s of series.values()) {
    const byNumber = new Map<number, (typeof s.books)[number][]>()
    for (const b of s.books) if (b.number) byNumber.set(b.number, [...(byNumber.get(b.number) ?? []), b])
    for (const [number, at] of byNumber) {
      // copies of one book (an EPUB and a PDF of it) are one book
      if (new Set(at.map((b) => norm(b.name))).size > 1) issues.push({ kind: 'duplicate', series: s.name, number, books: at.map(({ id, title, author }) => ({ id, title, author })) })
    }
    const groups = authorGroups(s.books, oneAuthor)
    if (groups.length > 1) issues.push({ kind: 'authors', series: s.name, authors: groups.map((g) => g[0]![0]), books: s.books.map(({ id, title, author }) => ({ id, title, author })) })
    const numbers = [...byNumber.keys()]
    if (numbers.length >= 2) {
      const last = Math.max(...numbers)
      const missing = Array.from({ length: last }, (_, i) => i + 1).filter((n) => !byNumber.has(n))
      // a series numbered from far along ("55, 56") is a long one the library has a part of: no gaps for it
      if (missing.length && missing.length <= Math.max(3, numbers.length)) issues.push({ kind: 'gap', series: s.name, missing })
    }
  }
  // one series under several spellings: the same sound (the consonants, Hebrew or Latin) and the same author, or one of
  // them with none; a name too short to tell by its sound is left alone
  const bySound = new Map<string, NonNullable<ReturnType<typeof series.get>>[]>()
  for (const s of series.values()) {
    const sound = soundOf(s.name)
    if (sound.length >= 4) bySound.set(sound, [...(bySound.get(sound) ?? []), s])
  }
  const sameWriter = (x: Book[], y: Book[]) => {
    const xs = x.map((b) => b.author.trim()).filter(Boolean)
    const ys = y.map((b) => b.author.trim()).filter(Boolean)
    return !xs.length || !ys.length || xs.some((a) => ys.some((c) => oneAuthor(a, c)))
  }
  for (const group of bySound.values()) {
    if (group.length < 2) continue
    const [main, ...rest] = [...group].sort((x, y) => y.books.length - x.books.length)
    const others = rest.filter((o) => sameWriter(main!.books, o.books))
    if (others.length)
      issues.push({ kind: 'series', main: main!.name, others: others.map((o) => o.name), books: others.flatMap((o) => o.books.map(({ id, title, author }) => ({ id, title, author }))) })
  }
  const order: Issue['kind'][] = ['duplicate', 'authors', 'series', 'author', 'gap']
  return issues.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}
