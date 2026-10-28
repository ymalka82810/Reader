// The blind test: the identification measured on the library it actually meets, without asking the user anything. Now and
// then (in the background, offline) a few books whose name the user gave are identified again as if they were new: from
// what they came with (their file's name, their package's title and author, their pages), with their own name hidden from
// the library (the book is not among its books, and its title not among the names it saved). What comes out is compared
// with the user's name, part by part, and so is every clue that spoke: the real precision of this library's
// identification, of the names that would have been saved without asking, and of each clue here. What each test found
// also teaches the clues' records and the model, as half an answer (identifyLearning's learnFromBlind). Kept on the device.

import { hideTitle } from './bookKnowledge'
import { identifyBook, keptPrint, libraryNames } from './bookLookup'
import { splitBookName } from './bookName'
import type { EpubMeta } from './bookText'
import { CLUES, type Clue } from './clues'
import type { BookMeta } from './db'
import { caseFromBook, FIELDS, same } from './identifyBench'
import { isConfirmed, learnFromBlind } from './identifyLearning'

const KEY = 'reader:identify:blind'
const AT_KEY = 'reader:identify:blind-at'
/** books kept, and the books gone over in one run */
const MAX = 600
const PER_RUN = 12
/** a run once a week at most, on its own */
const EVERY = 7 * 24 * 60 * 60 * 1000

type Field = (typeof FIELDS)[number]

/** one book's test: for each part of the name, whether it came out right (null: the user's name has no such part to check) */
interface BlindResult {
  at: number
  parts: Partial<Record<Field, boolean>>
  /** every part checked was right */
  whole: boolean
  /** the name would have been saved without asking */
  sure: boolean
  evidence: Clue[]
  conflicts: Clue[]
}

function results(): Record<string, BlindResult> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return v && typeof v === 'object' ? (v as Record<string, BlindResult>) : {}
  } catch {
    return {}
  }
}

function keep(id: string, r: BlindResult) {
  const all = results()
  delete all[id]
  all[id] = r
  const ids = Object.keys(all)
  for (const old of ids.slice(0, Math.max(0, ids.length - MAX))) delete all[old]
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* storage unavailable */
  }
}

/** whether a run is due: never run, or not this week */
export function blindDue(now = Date.now()): boolean {
  const at = Number(globalThis.localStorage?.getItem(AT_KEY) ?? 0) || 0
  return now - at >= EVERY
}

/** the user's name against what the identification found, part by part (the number only for a book of a series, the
 *  author only when the user gave one) */
export function compare(name: { title: string; author: string }, got: { series: string; number?: string; title: string; author: string }) {
  const want = { ...splitBookName(name.title), author: name.author.trim() }
  const parts: Partial<Record<Field, boolean>> = {}
  for (const f of FIELDS) {
    const w = want[f] ?? ''
    if (f === 'number' && !want.series) continue
    if (f === 'author' && !w) continue
    parts[f] = same(f, w, got[f] ?? '')
  }
  return { parts, whole: Object.values(parts).every(Boolean) }
}

type Details = (b: BookMeta, signal?: AbortSignal) => Promise<{ opening: string[]; meta?: EpubMeta }>

/**
 * Goes over a few of the books the user named (those tested longest ago first), each identified as a new book with its
 * name hidden, and keeps how it did. Resolves with how many were tested; rejects only when `signal` aborts.
 */
export async function runBlindTest(
  books: BookMeta[],
  signal?: AbortSignal,
  { max = PER_RUN, onProgress, details }: { max?: number; onProgress?: (done: number, total: number) => void; details?: Details } = {},
): Promise<number> {
  const read: Details = details ?? (async (b, s) => (await import('./bookText')).bookDetails(b, s))
  const kept = results()
  const named = books
    .filter((b) => (b.kind === 'epub' || b.kind === 'pdf') && isConfirmed(b.id, b.title))
    .sort((x, y) => (kept[x.id]?.at ?? 0) - (kept[y.id]?.at ?? 0))
    .slice(0, max)
  let done = 0
  for (const b of named) {
    signal?.throwIfAborted()
    onProgress?.(done, named.length)
    // hidden for the whole test of the book (its own reading included), shown again whatever happens
    hideTitle(splitBookName(b.title).title)
    try {
      const d = await read(b, signal)
      // what the book came with, as when it was added (identifyBench's cases are made the same way)
      const { input } = caseFromBook(b, d)
      const print = keptPrint(b.id)
      const meta = d.meta && print ? { ...d.meta, print } : d.meta
      const library = libraryNames(books.filter((x) => x.id !== b.id))
      const r = await identifyBook({ ...input, id: b.id, kind: b.kind } as typeof input, false, signal, d.opening, meta, library)
      const c = compare({ title: b.title, author: b.author ?? '' }, r)
      keep(b.id, { at: Date.now(), ...c, sure: !!r.sure, evidence: r.evidence ?? [], conflicts: r.conflicts ?? [] })
      // and the clues learn from it, half an answer's worth
      learnFromBlind(b.id, r.evidence ?? [], r.conflicts ?? [], c.whole)
    } catch (e) {
      if (signal?.aborted) throw e
      console.warn(e) // this book is tried again in a later run
    } finally {
      hideTitle()
    }
    done++
  }
  onProgress?.(done, named.length)
  try {
    localStorage.setItem(AT_KEY, String(Date.now()))
  } catch {
    /* storage unavailable */
  }
  return done
}

type Tally = { right: number; of: number }

/** what the blind tests found, over the books still named as the user named them */
export function blindReport(books: { id: string; title: string }[]) {
  const all = results()
  const mine = books.filter((b) => all[b.id] && isConfirmed(b.id, b.title)).map((b) => all[b.id]!)
  const tally = (f: (r: BlindResult) => boolean | undefined): Tally => {
    const xs = mine.map(f).filter((x): x is boolean => x !== undefined)
    return { right: xs.filter(Boolean).length, of: xs.length }
  }
  const sure = mine.filter((r) => r.sure)
  const clues = CLUES.map((clue) => ({
    clue,
    // a clue that agreed was right when the name was; one that spoke against was right when it was not
    agreed: tally((r) => (r.evidence.includes(clue) ? r.whole : undefined)),
    against: tally((r) => (r.conflicts.includes(clue) ? !r.whole : undefined)),
  })).filter((c) => c.agreed.of || c.against.of)
  return {
    books: mine.length,
    parts: Object.fromEntries(FIELDS.map((f) => [f, tally((r) => r.parts[f])])) as Record<Field, Tally>,
    whole: tally((r) => r.whole),
    sure: { right: sure.filter((r) => r.whole).length, of: sure.length },
    clues,
    at: Math.max(0, ...mine.map((r) => r.at)),
  }
}
