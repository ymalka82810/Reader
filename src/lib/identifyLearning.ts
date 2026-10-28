// What the identification learns from the user. A name the user saved or approved is the book's own (an anchor): it is
// never identified again by itself, and the books around it are (see autoIdentify's cascade). A name the user turned down
// is not offered again for that book. And every answer the user gives about a name the identification found tells which
// clues were right: a clue that agreed with an approved name, or spoke against a declined one, was right; the other way,
// it was wrong. Each clue's record decides how much it counts the next time (`trusted`, `blocks`), so the weighing
// tunes itself to the library it actually meets instead of to fixed rules. Kept on the device.

import { rememberName } from './bookKnowledge'
import { CLUES, STRONG, type Clue } from './clues'
import { guessBookName, splitBookName, tidyBookName } from './bookName'
import { learnAnswer } from './identifyModel'
import { learnLinesOf } from './lineModel'
import { norm } from './sameBook'

const CONFIRMED_KEY = 'reader:identify:confirmed'
const DECLINED_KEY = 'reader:identify:declined'
const AUTO_KEY = 'reader:identify:auto'
const CLUES_KEY = 'reader:identify:clues'
const OUTCOMES_KEY = 'reader:identify:outcomes'
const PAIRS_KEY = 'reader:identify:pairs'
const MAX = 3000

type Tally = { right: number; wrong: number }
type ClueStats = Partial<Record<Clue, { for?: Tally; against?: Tally }>>

function read<T>(key: string, empty: T): T {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return v && typeof v === 'object' ? (v as T) : empty
  } catch {
    return empty
  }
}

function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* storage unavailable: learnt until the app closes at most */
  }
}

/** a record keyed by book, cut to the newest MAX entries */
function put(key: string, id: string, value: unknown) {
  const all = read<Record<string, unknown>>(key, {})
  delete all[id]
  all[id] = value
  const ids = Object.keys(all)
  for (const old of ids.slice(0, Math.max(0, ids.length - MAX))) delete all[old]
  write(key, all)
}

function drop(key: string, id: string) {
  const all = read<Record<string, unknown>>(key, {})
  if (!(id in all)) return
  delete all[id]
  write(key, all)
}

// ---- anchors

/** the user saved or approved this name for the book (by this author): it is kept as what is known of its series too */
export function confirmName(id: string, title: string, author = '') {
  put(CONFIRMED_KEY, id, title)
  rememberName(title, author)
  // the lines of its opening, tagged by this name, teach the line classifier
  learnLinesOf(id, splitBookName(title), author)
  drop(DECLINED_KEY, id)
  drop(AUTO_KEY, id)
}

/** the books the user gave a name (whatever their name is now): the anchors a series is placed around */
export function confirmedIds(): Set<string> {
  return new Set(Object.keys(read<Record<string, string>>(CONFIRMED_KEY, {})))
}

/** whether the book still has the name the user gave it (a book renamed since by anything else is not) */
export function isConfirmed(id: string, title: string): boolean {
  return read<Record<string, string>>(CONFIRMED_KEY, {})[id] === title
}

/** the user turned this offered name down */
export function declineName(id: string, offered: string) {
  const all = read<Record<string, string[]>>(DECLINED_KEY, {})
  put(DECLINED_KEY, id, [...new Set([...(all[id] ?? []), offered])].slice(-5))
}

/** whether the user already turned this very name down for the book */
export function wasDeclined(id: string, offered: string): boolean {
  return (read<Record<string, string[]>>(DECLINED_KEY, {})[id] ?? []).includes(offered)
}

// ---- names saved without asking: a later edit of the user's tells whether they were right

type Auto = { title: string; evidence: Clue[]; conflicts: Clue[]; leaned?: string[] }

/** a sure name the identification saved by itself, the clues that made it sure, and the other books of the library it
 *  leaned on (their numbers and years placed it): when one of them is corrected, this name is gone over again */
export function rememberAuto(id: string, title: string, evidence: Clue[] = [], conflicts: Clue[] = [], leaned: string[] = []) {
  put(AUTO_KEY, id, { title, evidence, conflicts, ...(leaned.length && { leaned: [...new Set(leaned)].filter((x) => x !== id).slice(0, 40) }) })
  countOutcome('autoSaved')
  setRecent(id, true)
}

/** The names saved by themselves that leaned on these books (see rememberAuto): a correction of one of these books takes
 *  away what they stood on, so they are identified again, whatever series the corrected book has moved to. */
export function dependents(ids: Iterable<string>): string[] {
  const changed = new Set(ids)
  const auto = read<Record<string, Auto>>(AUTO_KEY, {})
  return Object.entries(auto)
    .filter(([id, a]) => !changed.has(id) && a.leaned?.some((x) => changed.has(x)))
    .map(([id]) => id)
}

// ---- how right the names saved by themselves have been lately

const RECENT_KEY = 'reader:identify:recent'
/** how many of the latest saved names are judged, and how many are needed before they are */
const RECENT_MAX = 50
const RECENT_MIN = 20
/** below this share kept by the user, a name needs one more clue to be saved without asking */
const RECENT_BAR = 0.9

/** the latest names saved by themselves, by book, each with whether the user kept its place (until told otherwise) */
function setRecent(id: string, kept: boolean) {
  const all = read<[string, boolean][]>(RECENT_KEY, [])
  write(RECENT_KEY, [...all.filter(([x]) => x !== id), [id, kept] as [string, boolean]].slice(-RECENT_MAX))
}

/** the share of the latest names saved by themselves the user kept (not the whole history: a rule that was mended
 *  stops counting against the identification); undefined before enough of them were judged */
export function recentPrecision(): number | undefined {
  const all = read<[string, boolean][]>(RECENT_KEY, [])
  return all.length < RECENT_MIN ? undefined : all.filter(([, kept]) => kept).length / all.length
}

/** whether the latest names saved by themselves were wrong too often: a name is then saved without asking only on one
 *  more clue, until the user's answers say it is right again */
export function needsMoreProof(): boolean {
  const p = recentPrecision()
  return p !== undefined && p < RECENT_BAR
}

/** the place in a series a name gives: its series and number, compared without spelling */
function placeOf(title: string): string {
  const g = guessBookName(tidyBookName(title))
  return g.series ? `${norm(g.series)}|${Number(g.number) || ''}` : `|${norm(g.title)}`
}

/** two names that put the book in the same place: the same series and number, or the same title with no series */
export function samePlace(a: string, b: string): boolean {
  return placeOf(a) === placeOf(b)
}

/**
 * The user saved a name for a book by hand. If the identification had saved another name for it by itself, the clues
 * behind that one are judged by whether the user kept its place; either way the user's name is the book's from now on.
 */
export function learnFromEdit(id: string, title: string, author = '') {
  const auto = read<Record<string, Auto>>(AUTO_KEY, {})[id]
  if (auto) {
    const kept = samePlace(auto.title, title)
    recordOutcome(auto.evidence, auto.conflicts, kept)
    if (!kept) countOutcome('autoCorrected')
    setRecent(id, kept)
  }
  confirmName(id, title, author)
}

// ---- the clues' records

export function clueStats(): ClueStats {
  return read<ClueStats>(CLUES_KEY, {})
}

/** the user's answer about a name: `right` when the name was approved (as offered, or in the same place) */
export function recordOutcome(evidence: Clue[] = [], conflicts: Clue[] = [], right: boolean) {
  if (!evidence.length && !conflicts.length) return
  const stats = clueStats()
  const bump = (c: Clue, side: 'for' | 'against', ok: boolean) => {
    const s = (stats[c] ??= {})
    const t = (s[side] ??= { right: 0, wrong: 0 })
    if (ok) t.right++
    else t.wrong++
  }
  for (const c of new Set(evidence)) bump(c, 'for', right)
  for (const c of new Set(conflicts)) bump(c, 'against', !right)
  write(CLUES_KEY, stats)
  // the clues that agreed with a wrong name together: two that are wrong together again and again are one source
  if (!right) {
    const wrong = [...new Set(evidence)].sort()
    if (wrong.length > 1) {
      const pairs = pairStats()
      for (const [i, a] of wrong.entries()) for (const b of wrong.slice(i + 1)) pairs[`${a}|${b}`] = (pairs[`${a}|${b}`] ?? 0) + 1
      write(PAIRS_KEY, pairs)
    }
  }
  // the same answer trains the model that weighs all the clues together
  learnAnswer(evidence, conflicts, right)
}

// ---- sources: clues that come from one place say one thing, however many of them say it

/** the clues known to come from one source before anything is learnt: the file's name and its package are mostly named
 *  by the same hand; the story's names and its vocabulary are one reading of it; the years and the pace are one set of
 *  years */
const SOURCE: Partial<Record<Clue, string>> = { name: 'file', meta: 'file', names: 'story', words: 'story', debut: 'story', years: 'years', rhythm: 'years' }

/** how many wrong names two clues agreed with together, by "a|b" (sorted) */
function pairStats(): Record<string, number> {
  return read<Record<string, number>>(PAIRS_KEY, {})
}

/** wrong together this often (of the names either was wrong about), and this many times at least: one source */
const TOGETHER = 0.6
const TOGETHER_MIN = 3

/** the pairs of clues the user's answers show to be one source: they were wrong together on most of the names either was
 *  wrong about (each clue's record counts its wrong names) */
export function learntSources(stats: ClueStats = clueStats()): [Clue, Clue][] {
  const out: [Clue, Clue][] = []
  for (const [k, both] of Object.entries(pairStats())) {
    const [a, b] = k.split('|') as [Clue, Clue]
    const wa = stats[a]?.for?.wrong ?? 0
    const wb = stats[b]?.for?.wrong ?? 0
    const either = wa + wb - both
    if (both >= TOGETHER_MIN && either > 0 && both / either >= TOGETHER) out.push([a, b])
  }
  return out
}

/** How many independent sources these clues are: the clues of one source (SOURCE, and the pairs learnt to be one) count
 *  once. A sure name needs agreeing sources, not agreeing names of clues. */
export function sources(clues: readonly Clue[], stats: ClueStats = clueStats()): number {
  const root = new Map<string, string>()
  const find = (x: string): string => {
    const r = root.get(x) ?? x
    if (r === x) return x
    const top = find(r)
    root.set(x, top)
    return top
  }
  const join = (a: string, b: string) => {
    const x = find(a)
    const y = find(b)
    if (x !== y) root.set(x, y)
  }
  const of = (c: Clue) => SOURCE[c] ?? c
  for (const [a, b] of learntSources(stats)) join(of(a), of(b))
  return new Set(clues.map((c) => find(of(c)))).size
}

// as many answers as the starting belief is worth: a few answers move it, many outweigh it
const PRIOR = 4

/** how often a clue was right when it agreed (`for`) or spoke against (`against`), starting from what it is believed to
 *  be worth before anything is learned: a strong clue, and any clue against, are mostly right; a weak one less than half the time */
function trust(c: Clue, side: 'for' | 'against', stats: ClueStats = clueStats()): number {
  const believed = side === 'against' || STRONG.includes(c) ? 0.9 : 0.4
  const t = stats[c]?.[side] ?? { right: 0, wrong: 0 }
  return (t.right + PRIOR * believed) / (t.right + t.wrong + PRIOR)
}

/** a clue that agrees counts toward a sure name: so are the strong ones until they prove wrong, and a weak one that
 *  proved right often enough */
export function trusted(c: Clue, stats: ClueStats = clueStats()): boolean {
  return trust(c, 'for', stats) >= 0.7
}

/** a clue that speaks against keeps the name from being saved without asking, unless it mostly proved wrong */
export function blocks(c: Clue, stats: ClueStats = clueStats()): boolean {
  return trust(c, 'against', stats) >= 0.5
}

// ---- how well the identification does, by the user's answers

/** approved: a suggestion saved in the place offered; corrected: saved in another place; declined: turned down;
 *  autoSaved: a name saved without asking; autoCorrected: one of those the user then moved to another place */
export type Outcome = 'approved' | 'corrected' | 'declined' | 'autoSaved' | 'autoCorrected'
export type Outcomes = Record<Outcome, number>

export function outcomes(): Outcomes {
  return { approved: 0, corrected: 0, declined: 0, autoSaved: 0, autoCorrected: 0, ...read<Partial<Outcomes>>(OUTCOMES_KEY, {}) }
}

export function countOutcome(o: Outcome) {
  const all = outcomes()
  all[o]++
  write(OUTCOMES_KEY, all)
}

/** each clue's record: how often it was right when it agreed and when it spoke against, and how much it counts now */
export function clueReport(): { clue: Clue; agreed: Tally; against: Tally; trust: number; counts: boolean; blocks: boolean }[] {
  const stats = clueStats()
  return CLUES.map((c) => ({
    clue: c,
    agreed: stats[c]?.for ?? { right: 0, wrong: 0 },
    against: stats[c]?.against ?? { right: 0, wrong: 0 },
    trust: trust(c, 'for', stats),
    counts: trusted(c, stats),
    blocks: blocks(c, stats),
  }))
}

/** where the library's books stand: with a series and a number, a series alone, or none; and how many the user named */
export function coverage(books: { id: string; title: string }[]) {
  let numbered = 0
  let seriesOnly = 0
  for (const b of books) {
    const g = guessBookName(tidyBookName(b.title))
    if (g.series && g.number) numbered++
    else if (g.series) seriesOnly++
  }
  const confirmed = books.filter((b) => isConfirmed(b.id, b.title)).length
  return { total: books.length, numbered, seriesOnly, none: books.length - numbered - seriesOnly, confirmed }
}
