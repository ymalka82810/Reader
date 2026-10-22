// The identification's benchmark: books as they come (a file name, the package's title and author, the opening pages)
// with the name each should get, run through identifyBook offline. It tells, for each part of the name (series,
// number, title, author), how many books got it right, so a change to the rules is measured on all the books at once
// rather than on the one that was fixed: a rule that helps one book and hurts two others shows as a lower score.
// The cases are real books: a book whose name the user approved or saved can be exported as a case (caseFromBook).
import { identifyBook, libraryNames } from './bookLookup'
import { formatBookName, splitBookName } from './bookName'
import type { EpubMeta } from './bookText'
import { norm } from './sameBook'

export interface BenchCase {
  /** a short name for the case, shown when it fails */
  id: string
  input: { title: string; author: string; fileName: string; opening?: string[]; meta?: EpubMeta }
  /** the name the book should get; a part left out is not checked */
  expect: { series?: string; number?: string; title?: string; author?: string }
  /** other books the library has (their names in the template), when the case depends on them */
  library?: { title: string; author?: string }[]
}

export const FIELDS = ['series', 'number', 'title', 'author'] as const
type Field = (typeof FIELDS)[number]

interface BenchResult {
  /** per field: right / checked */
  score: Record<Field, { right: number; of: number }>
  /** cases with every checked part right */
  whole: { right: number; of: number }
  failures: { id: string; field: Field; want: string; got: string }[]
}

/** "5" and "05" are one number; names are compared without nikud, quotes and punctuation */
function same(field: Field, want: string, got: string): boolean {
  if (field === 'number') {
    const a = /^\d+/.exec(want.trim())?.[0]
    const b = /^\d+/.exec(got.trim())?.[0]
    return a !== undefined || b !== undefined ? Number(a) === Number(b) : norm(want) === norm(got)
  }
  return norm(want) === norm(got)
}

/** Runs every case offline, each in a fresh device (its own storage), with the library its case names. */
export async function runBench(cases: BenchCase[]): Promise<BenchResult> {
  const score = Object.fromEntries(FIELDS.map((f) => [f, { right: 0, of: 0 }])) as BenchResult['score']
  const whole = { right: 0, of: 0 }
  const failures: BenchResult['failures'] = []
  for (const c of cases) {
    try {
      localStorage.clear()
    } catch {
      /* no storage: nothing kept between cases anyway */
    }
    const library = c.library?.length ? libraryNames(c.library) : undefined
    const r = await identifyBook(c.input, false, undefined, c.input.opening ?? [], c.input.meta, library)
    let all = true
    for (const f of FIELDS) {
      const want = c.expect[f]
      if (want === undefined) continue
      score[f].of++
      const got = r[f] ?? ''
      if (same(f, want, got)) score[f].right++
      else {
        all = false
        failures.push({ id: c.id, field: f, want, got })
      }
    }
    whole.of++
    if (all) whole.right++
  }
  return { score, whole, failures }
}

const pct = (x: { right: number; of: number }) => (x.of ? Math.round((1000 * x.right) / x.of) / 10 : 100)

/** the result as percentages, the way the baseline keeps it */
export function percentages(r: BenchResult): Record<Field | 'whole', number> {
  return { ...(Object.fromEntries(FIELDS.map((f) => [f, pct(r.score[f])])) as Record<Field, number>), whole: pct(r.whole) }
}

/** A case from a book of the library whose name the user approved or saved: what the book came with (its file name,
 *  its package's title and author, its opening pages) and the name it has now. The opening is cut to its first lines,
 *  the title and copyright pages, which is what the identification reads of it. */
export function caseFromBook(
  b: { id: string; title: string; author: string; fileName: string },
  details: { opening: string[]; meta?: EpubMeta },
): BenchCase {
  const name = splitBookName(b.title)
  const meta = details.meta && {
    ...details.meta,
    // the story's names and words are many and long: the benchmark does not need them
    names: undefined,
    words: undefined,
  }
  const stemmed = b.fileName.replace(/\.[^.]+$/, '')
  return {
    id: formatBookName(name) || b.id,
    input: {
      title: details.meta?.title || stemmed,
      author: details.meta?.authors?.[0] ?? '',
      fileName: b.fileName,
      ...(details.opening.length && { opening: details.opening.slice(0, 40) }),
      ...(meta && { meta: JSON.parse(JSON.stringify(meta)) as EpubMeta }),
    },
    expect: { series: name.series, number: name.number, title: name.title, ...(b.author && { author: b.author }) },
  }
}
