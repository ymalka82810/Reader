// Identifying books by themselves: the books just added are identified at the end of the import queue (see
// hooks/useImport), in the background like the import itself. A sure name (found by its ISBN, by the same title and
// author, or a series from the EPUB's package) is saved at once; any other new name waits in a list the library offers
// for approval. Google Books is asked only when the user already agreed to it; otherwise only the book's own names,
// package and opening pages are read.
// The books already in the library are identified the same way once, on the first start after this came in (the
// "backfill"): what is left of it is kept, so a run stopped by closing the app goes on at the next start.

import { identifyBook, libraryNames, type Clue } from './bookLookup'
import { formatBookName, isJunkTitle } from './bookName'
import { bookDetails } from './bookText'
import { hasConsent } from './consent'
import { getBookMeta, listBooks, updateMeta } from './db'
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
// and weighs the clues
const KEY = 'reader:identify:pending7'
const OLD_KEYS = ['pending', 'backfill', 'pending2', 'backfill2', 'pending3', 'backfill3', 'pending4', 'backfill4', 'pending5', 'backfill5', 'pending6', 'backfill6'].map(
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

const BACKFILL = 'reader:identify:backfill7'

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

/**
 * Identifies the given books one after another. A sure new name is saved (and the book's file on the phone follows it,
 * as after any rename); any other new name is put on the waiting list. A book that fails to be identified is skipped.
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
  // the series and authors the library already has, which split a name that has no dash
  const library = libraryNames(await listBooks().catch(() => []))
  for (const [i, id] of ids.entries()) {
    signal.throwIfAborted()
    if (i && gap) await pause(gap, signal)
    onProgress?.(i, ids.length)
    try {
      const b = await getBookMeta(id)
      if (!b) continue
      const { opening, meta } = await bookDetails(b, signal)
      const r = await identifyBook(b, online, signal, opening, meta, library)
      if (r.failed) {
        online = false
        why = r.why ?? 'network'
        onOffline?.(why)
      }
      if (r.failed || (hasConsent('books') && !online)) again.push(id)
      const title = formatBookName(r)
      const author = r.author
      // a name that still says nothing ("5E70B~1") is not worth offering
      if (!title || (isJunkTitle(r.title) && !(r.series && r.number)) || (title === b.title && author === (b.author ?? '').trim())) continue
      // only the mark that keeps "פרויקט X 5" from showing as "פרויקט 5 X" is new: nothing to ask about
      const marksOnly = unmarked(title) === unmarked(b.title) && author === (b.author ?? '').trim()
      if ((r.sure && saveSure) || marksOnly) {
        await updateMeta(id, title, author)
        saved++
        dropPending([id])
        await autoSyncPhoneNames([id]).catch(() => {})
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
      if (!signal.aborted) onLeft?.(ids.slice(i + 1))
    }
  }
  onProgress?.(ids.length, ids.length)
  if (again.length) askAgainLater(again, why ?? 'network')
  return { saved, pending, ...(again.length && { later: again.length, why }) }
}
