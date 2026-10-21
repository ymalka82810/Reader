// Identifying books by themselves: the books just added are identified at the end of the import queue (see
// hooks/useImport), in the background like the import itself. A sure name (found by its ISBN, by the same title and
// author, or a series from the EPUB's package) is saved at once; any other new name waits in a list the library offers
// for approval. Google Books is asked only when the user already agreed to it; otherwise only the book's own names,
// package and opening pages are read.

import { identifyBook } from './bookLookup'
import { formatBookName } from './bookName'
import { bookDetails } from './bookText'
import { hasConsent } from './consent'
import { getBookMeta, updateMeta } from './db'
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
}

const KEY = 'reader:identify:pending'
const listeners = new Set<() => void>()
let cache: PendingName[] | undefined

export function loadPending(): PendingName[] {
  if (!cache) {
    try {
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

/**
 * Identifies the given books one after another. A sure new name is saved (and the book's file on the phone follows it,
 * as after any rename); any other new name is put on the waiting list. A book that fails to be identified is skipped.
 * Resolves with how many were saved and how many wait; rejects only when `signal` aborts.
 */
export async function identifyNew(
  ids: string[],
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<{ saved: number; pending: number }> {
  const online = hasConsent('books')
  const saveSure = loadSettings().autoIdentifySave
  const saved: string[] = []
  const waiting: PendingName[] = []
  for (const [i, id] of ids.entries()) {
    signal.throwIfAborted()
    onProgress?.(i, ids.length)
    try {
      const b = await getBookMeta(id)
      if (!b) continue
      const { opening, meta } = await bookDetails(b, signal)
      const r = await identifyBook(b, online, signal, opening, meta)
      const title = formatBookName(r)
      const author = r.author
      if (!title || (title === b.title && author === (b.author ?? '').trim())) continue
      if (r.sure && saveSure) {
        await updateMeta(id, title, author)
        saved.push(id)
      } else {
        const source = r.online ? 'web' : r.fromText ? 'text' : r.fromMeta ? 'meta' : 'name'
        waiting.push({ id, title, author, was: b.title, source })
      }
    } catch (e) {
      if (signal.aborted) throw e
      console.warn(e) // this book stays as it was; the rest go on
    }
  }
  onProgress?.(ids.length, ids.length)
  addPending(waiting)
  dropPending(saved)
  if (saved.length) await autoSyncPhoneNames(saved).catch(() => {})
  return { saved: saved.length, pending: waiting.length }
}
