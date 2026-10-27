// Identifying books by themselves: the books just added are identified at the end of the import queue (see
// hooks/useImport), in the background like the import itself. A sure name (found by its ISBN, by the same title and
// author, or a series from the EPUB's package) is saved at once; any other new name waits in a list the library offers
// for approval. Google Books is asked only when the user already agreed to it; otherwise only the book's own names,
// package and opening pages are read.
// The books already in the library are identified the same way once, on the first start after this came in (the
// "backfill"): what is left of it is kept, so a run stopped by closing the app goes on at the next start.

import { rememberName, rememberSequels } from './bookKnowledge'
import { keepFacts, libraryNames, type Clue } from './bookLookup'
import { identifyWithCover } from './coverIdentify'
import { formatBookName, guessBookName, isJunkTitle, tidyBookName } from './bookName'
import { bookDetails } from './bookText'
import { hasConsent } from './consent'
import { getBookMeta, listBooks, updateMeta } from './db'
import { isConfirmed, rememberAuto, wasDeclined } from './identifyLearning'
import { norm } from './sameBook'
import { autoSyncPhoneNames } from './phoneFiles'
import { loadSettings } from './settings'

/** a name found for a book, waiting for the user's approval */
export interface PendingName {
  id: string
  title: string
  author: string
  /** the book's name when it was identified: a book renamed since then is not offered any more */
  was: string
  source: 'web' | 'text' | 'meta' | 'name'
  /** for 'web': the catalogs that gave the name ("Google Books", "Open Library", "Wikidata") */
  sites?: string[]
  /** the clues that agree with the name, and those that say otherwise */
  evidence?: Clue[]
  conflicts?: Clue[]
}

// "3" (and "2" before it): the names found before the identification learned to tell a title from a publisher's address or a review were
// dropped, and the library is identified once more (BACKFILL); "3" also takes download-site leftovers out of names, "4"
// splits names by what the library knows and marks a Latin series' number, "5" reads more Anna's Archive names and
// takes "רבי־המכר" out of a series, "6" finds a title among a joined line's words and asks Google Books less, "7" infers
// from inside the book (the copyright page, a running head, the series' list and characters, the library's numbering)
// and weighs the clues, "8" asks a series by its characters to share its main ones and no more guesses the next number, "9"
// keeps a title's own number after a joining word ("לחלום על 10") and lets a second copy of a book hold its number, "10"
// places a book by its series' cast (not one book's characters) and numbers a series with none by its years, "11"
// mends names broken at a joining word, places a book by the years of all its series' books and tidies the titles, "12"
// looks for the real title of a book whose title only repeats its series and number; the one-time identification "13"
// went over the library with the cascade, the clues learnt from the user, the series' fingerprint, the knowledge kept on
// the device and the book before and after; "14" (with a new waiting list, "13") again, without the series said twice,
// a publisher taken for the author, or a fingerprint of another author's series; "17" once more over the whole library, for
// the names that carry their author ("מחבר - שם"), the names no one chose ("3EA41~1", "CamScanner …"), a number inside a
// title the lists know, and the author a cover prints; "18" also the author that books of the library share across their names
const KEY = 'reader:identify:pending13'
const OLD_KEYS = ['pending', 'backfill', 'pending2', 'backfill2', 'pending3', 'backfill3', 'pending4', 'backfill4', 'pending5', 'backfill5', 'pending6', 'backfill6', 'pending7', 'backfill7', 'pending8', 'backfill8', 'pending9', 'backfill9', 'pending10', 'backfill10', 'pending11', 'backfill11', 'pending12', 'backfill12', 'backfill13', 'backfill14', 'backfill15', 'backfill16', 'backfill17'].map(
  (k) => `reader:identify:${k}`,
)
const listeners = new Set<() => void>()
let cache: PendingName[] | undefined

export function loadPending(): PendingName[] {
  if (!cache) {
    try {
      for (const k of OLD_KEYS) localStorage.removeItem(k)
      const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
      cache = Array.isArray(v) ? (v as PendingName[]) : []
    } catch {
      cache = []
    }
  }
  return cache
}

function savePending(list: PendingName[]) {
  cache = list
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: the list lives until the app closes */
  }
  listeners.forEach((l) => l())
}

export function subscribePending(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** takes books off the waiting list: approved, turned down, or no longer in the library */
export function dropPending(ids: Iterable<string>) {
  const gone = new Set(ids)
  const list = loadPending()
  if (list.some((p) => gone.has(p.id))) savePending(list.filter((p) => !gone.has(p.id)))
}

function addPending(items: PendingName[]) {
  if (!items.length) return
  const ids = new Set(items.map((p) => p.id))
  savePending([...loadPending().filter((p) => !ids.has(p.id)), ...items])
}

const BACKFILL = 'reader:identify:backfill18'

/** The books the one-time identification of the library still has to go through: all of `allIds` before it started,
 *  what is left after it was stopped, and undefined once it is done (or was cancelled). */
export function backfillLeft(allIds: string[]): string[] | undefined {
  loadPending() // drops the old lists first
  try {
    const v = localStorage.getItem(BACKFILL)
    const again = dueAgain()
    if (v === 'done' && !again.length) return undefined
    if (!v) return allIds
    const left = new Set([...(v === 'done' ? [] : (JSON.parse(v) as string[])), ...again])
    return allIds.filter((id) => left.has(id))
  } catch {
    return undefined // storage unavailable: better not to identify the whole library on every start
  }
}

/** keeps what the one-time identification still has to do; an empty list or none marks it done */
export function setBackfillLeft(left: string[] | undefined) {
  try {
    localStorage.setItem(BACKFILL, left?.length ? JSON.stringify(left) : 'done')
  } catch {
    /* storage unavailable */
  }
}

// A book whose name still says nothing is tried again from time to time, not only once: a cover that could not be read, a
// catalog that did not answer, or a new way of reading names may name it now. Once a day at most, and only on start.
const TRIED = 'reader:identify:junk-tried'
const RETRY_AFTER = 24 * 60 * 60 * 1000

function triedAt(): Record<string, number> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TRIED) ?? '{}')
    return v && typeof v === 'object' ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function markTried(ids: string[]) {
  try {
    const all = { ...triedAt() }
    for (const id of ids) all[id] = Date.now()
    localStorage.setItem(TRIED, JSON.stringify(all))
  } catch {
    /* storage unavailable: tried again at the next start */
  }
}

/** the books whose name still says nothing (no series and no title) and that were not tried in the last day */
export function unnamedIds(books: Named[]): string[] {
  const tried = triedAt()
  return books.filter((b) => !isConfirmed(b.id, b.title) && standing(b).junk && Date.now() - (tried[b.id] ?? 0) >= RETRY_AFTER).map((b) => b.id)
}

const unmarked = (s: string) => s.replace(/[\u200E\u200F]/g, '')

// books whose identification Google Books did not answer about, and when to ask again: a quota of requests is given
// back after some hours, a lost connection sooner
const AGAIN = 'reader:identify:again'
const AGAIN_AFTER = { quota: 6 * 60 * 60 * 1000, network: 30 * 60 * 1000 }

function askAgainLater(ids: string[], why: 'quota' | 'network') {
  try {
    const v = JSON.parse(localStorage.getItem(AGAIN) ?? 'null') as { ids: string[]; after: number } | null
    const after = Date.now() + AGAIN_AFTER[why]
    localStorage.setItem(AGAIN, JSON.stringify({ ids: [...new Set([...(v?.ids ?? []), ...ids])], after: Math.max(after, v?.after ?? 0) }))
  } catch {
    /* storage unavailable */
  }
}

/** the books to ask about again, once their time has come (they are then handed over, and the list is cleared) */
function dueAgain(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(AGAIN) ?? 'null') as { ids: string[]; after: number } | null
    if (!v || Date.now() < v.after) return []
    localStorage.removeItem(AGAIN)
    return v.ids
  } catch {
    return []
  }
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(id), reject(signal.reason)), { once: true })
  })

// ---- the cascade: a name found for one book is a clue for the books around it (its series, its author), so they are
// identified again with it; and what they turn out to be is a clue for theirs, round after round, until nothing more
// changes. A few rounds and a few dozen books at most, so a large library is not gone over again and again.
const CASCADE_ROUNDS = 4
const CASCADE_MAX = 40

type Named = { id: string; title: string; author?: string }

/** where a book stands: its series (compared without spelling), whether it has a number, and its author */
function standing(b: Named) {
  const g = guessBookName(tidyBookName(b.title))
  return { series: g.series ? norm(g.series) : '', numbered: !!g.number, junk: isJunkTitle(g.title) && !g.series, author: norm(b.author ?? '') }
}

/**
 * The books a change in these books' names may tell something new about, the likeliest first: the other books of their
 * series, then their author's books with no series or no number (or a name that says nothing), then their author's books
 * still waiting for approval. A name the user gave is left alone, and so are the books in `skip`.
 */
export function neighbours(changed: Named[], books: Named[], skip: ReadonlySet<string> = new Set()): string[] {
  const series = new Set<string>()
  const authors = new Set<string>()
  for (const c of changed) {
    const s = standing(c)
    if (s.series) series.add(s.series)
    if (s.author) authors.add(s.author)
  }
  const waiting = new Set(loadPending().map((p) => p.id))
  const done = new Set([...skip, ...changed.map((c) => c.id)])
  const ranked: [number, string][] = []
  for (const b of books) {
    if (done.has(b.id) || isConfirmed(b.id, b.title)) continue
    const s = standing(b)
    const rank =
      s.series && series.has(s.series)
        ? 0
        : s.author && authors.has(s.author) && (!s.series || !s.numbered || s.junk)
          ? 1
          : s.author && authors.has(s.author) && waiting.has(b.id)
            ? 2
            : undefined
    if (rank !== undefined) ranked.push([rank, b.id])
  }
  return ranked.sort((x, y) => x[0] - y[0]).map(([, id]) => id)
}

/**
 * Identifies the given books one after another. A sure new name is saved (and the book's file on the phone follows it,
 * as after any rename); any other new name is put on the waiting list. A book that fails to be identified is skipped,
 * and so is a name the user gave a book, or one the user already turned down. Every saved name is a clue for the rest:
 * the library the next books are read against is read again after it, and with `cascade` (the default) the books around
 * the saved ones are identified again after the given ones (see neighbours).
 * Resolves with how many were saved and how many wait; rejects only when `signal` aborts.
 */
export async function identifyNew(
  ids: string[],
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
  /** called after each book is dealt with (identified, skipped or failed), with the ones still to go */
  onLeft?: (left: string[]) => void,
  /** ms between books: a whole library at once would run into Google Books' limit on requests */
  gap = 0,
  /** called once, as soon as Google Books stops answering, with why */
  onOffline?: (why: 'quota' | 'network') => void,
  { cascade = true }: { cascade?: boolean } = {},
): Promise<{ saved: number; pending: number; later?: number; why?: 'quota' | 'network' }> {
  // when Google Books stops answering (too many requests, no network), the rest are identified from their own files and
  // are kept for the one-time identification to ask about again on the next start
  let online = hasConsent('books')
  const again: string[] = []
  let why: 'quota' | 'network' | undefined
  const saveSure = loadSettings().autoIdentifySave
  // each book's result is kept at once, so a run that is stopped keeps what it found
  let saved = 0
  let pending = 0
  // the series and authors the library already has, which split a name that has no dash; read again after every saved
  // name, so the next books are read against it
  let books: Named[] = await listBooks().catch(() => [])
  let library = libraryNames(books)
  // a book is gone over twice in a run at most (once more when a book around it was named after it), and a book named in
  // the run is not gone over again, so the cascade cannot go round in circles
  const visits = new Map<string, number>()
  const named = new Set<string>()
  let total = ids.length
  let round = ids
  let done = 0
  for (let turn = 0; round.length; turn++) {
    const savedNow: string[] = []
    for (const [i, id] of round.entries()) {
      signal.throwIfAborted()
      if (done && gap) await pause(gap, signal)
      onProgress?.(done, total)
      done++
      visits.set(id, (visits.get(id) ?? 0) + 1)
      try {
        const b = await getBookMeta(id)
        if (!b) continue
        if (standing(b).junk) markTried([id])
        const { opening, meta } = await bookDetails(b, signal)
        // what the book says of itself is kept for the books compared with it later (its series' fingerprint), and what
        // it says of its neighbours in the series is kept for them, by its name now
        keepFacts(id, opening, meta)
        rememberSequels(b.title, b.author, meta?.next, meta?.prev)
        // a name the user gave stays as it is
        if (isConfirmed(id, b.title)) continue
        // a name that still says nothing is read once more with the cover's lines
        const r = await identifyWithCover(b, online, signal, opening, meta, library)
        if (r.failed) {
          online = false
          why = r.why ?? 'network'
          onOffline?.(why)
        }
        if (r.failed || (hasConsent('books') && !online)) again.push(id)
        const title = formatBookName(r)
        const author = r.author
        // a name that still says nothing ("5E70B~1") is not worth offering, nor one the user already turned down
        if (!title || (isJunkTitle(r.title) && !(r.series && r.number)) || (title === b.title && author === (b.author ?? '').trim())) continue
        if (wasDeclined(id, title)) continue
        // only the mark that keeps "פרויקט X 5" from showing as "פרויקט 5 X" is new: nothing to ask about
        const marksOnly = unmarked(title) === unmarked(b.title) && author === (b.author ?? '').trim()
        if ((r.sure && saveSure) || marksOnly) {
          await updateMeta(id, title, author)
          saved++
          savedNow.push(id)
          named.add(id)
          if (!marksOnly) rememberAuto(id, title, r.evidence, r.conflicts)
          rememberName(title, author)
          rememberSequels(title, author, meta?.next, meta?.prev)
          dropPending([id])
          await autoSyncPhoneNames([id]).catch(() => {})
          books = await listBooks().catch(() => books)
          library = libraryNames(books)
        } else {
          const source = r.online ? 'web' : r.fromText ? 'text' : r.fromMeta ? 'meta' : 'name'
          addPending([
            {
              id,
              title,
              author,
              was: b.title,
              source,
              ...(r.online && r.sites && { sites: r.sites }),
              ...(r.evidence && { evidence: r.evidence }),
              ...(r.conflicts && { conflicts: r.conflicts }),
            },
          ])
          pending++
        }
      } catch (e) {
        if (signal.aborted) throw e
        console.warn(e) // this book stays as it was; the rest go on
      } finally {
        // also for a book skipped or unchanged; one stopped half-way is still to do
        if (!signal.aborted) onLeft?.(round.slice(i + 1))
      }
    }
    if (!cascade || !savedNow.length || turn + 1 >= CASCADE_ROUNDS || total - ids.length >= CASCADE_MAX) break
    const changed = books.filter((b) => savedNow.includes(b.id))
    const skip = new Set([...named, ...[...visits].filter(([, n]) => n >= 2).map(([id]) => id)])
    round = neighbours(changed, books, skip).slice(0, CASCADE_MAX - (total - ids.length))
    total += round.length
  }
  onProgress?.(total, total)
  if (again.length) askAgainLater(again, why ?? 'network')
  return { saved, pending, ...(again.length && { later: again.length, why }) }
}

/**
 * The books around these ones (see neighbours), identified again because the user just gave these their names. Resolves
 * with undefined when there are none.
 */
export async function identifyAround(
  ids: string[],
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<{ saved: number; pending: number } | undefined> {
  const books: Named[] = await listBooks().catch(() => [])
  const changed = books.filter((b) => ids.includes(b.id))
  const around = neighbours(changed, books).slice(0, CASCADE_MAX)
  if (!around.length) return undefined
  return identifyNew(around, signal, onProgress, undefined, 400)
}
