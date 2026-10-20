import type { BookMeta } from './db'
import { t } from '../i18n'

export type ReadState = 'all' | 'reading' | 'unread' | 'finished'

/** smart collections: '' = none, 'stale' = unfinished books not opened for a month, 'longest' = the biggest books */
export type Smart = '' | 'stale' | 'longest'
export const SMARTS: Exclude<Smart, ''>[] = ['stale', 'longest']
const STALE_DAYS = 30
const LONGEST_COUNT = 10
/** a book barely started (this fraction or less) drops out of the "continue reading" carousel after RESUME_STALE_DAYS */
const RESUME_MIN_FRACTION = 0.03
const RESUME_STALE_DAYS = 3

/** what the library list is narrowed to; every part that is set must match */
export interface LibraryFilter {
  state: ReadState
  /** file type from bookType(); '' = any */
  type: string
  /** folder key; undefined = any folder */
  folder?: string
  /** ids of hand-picked books; empty = no pick */
  ids: ReadonlySet<string>
  /** smart collection; unset = none */
  smart?: Smart
}

export const NO_FILTER: LibraryFilter = { state: 'all', type: '', ids: new Set() }

export const isFiltering = (f: LibraryFilter) =>
  f.state !== 'all' || !!f.type || f.folder !== undefined || f.ids.size > 0 || !!f.smart

/** the file type shown to the user: PDFs are stored as converted EPUBs, so they are told apart by `fromPdf` */
export function bookType(b: Pick<BookMeta, 'kind' | 'fromPdf' | 'fileName'>): string {
  if (b.kind === 'audio') return 'audio'
  if (b.fromPdf) return 'pdf'
  return /\.([a-z0-9]+)$/i.exec(b.fileName)?.[1]?.toLowerCase() ?? 'other'
}

export const typeLabel = (type: string) => (type === 'audio' ? t('filter.type.audio') : type === 'other' ? t('filter.type.other') : type.toUpperCase())

/** the types present in `books`, most common first */
export function typesOf(books: Pick<BookMeta, 'kind' | 'fromPdf' | 'fileName'>[]): string[] {
  const n = new Map<string, number>()
  for (const b of books) n.set(bookType(b), (n.get(bookType(b)) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
}

/** an unfinished book that was not opened (or, never opened, not added) in the last STALE_DAYS days */
export function isStale(b: Pick<BookMeta, 'lastOpened' | 'addedAt' | 'finished' | 'fraction'>, now: number): boolean {
  if (b.finished || (b.fraction ?? 0) >= 0.98) return false
  return now - (b.lastOpened ?? b.addedAt) > STALE_DAYS * 86_400_000
}

/** whether a book belongs in the "continue reading" carousel: started, not finished, not removed by hand since it was last
 *  opened, and not a barely-started book (3% or less) left untouched for more than 3 days */
export function inResume(
  b: Pick<BookMeta, 'lastOpened' | 'finished' | 'fraction' | 'resumeHiddenAt'>,
  now: number,
): boolean {
  const fraction = b.fraction ?? 0
  if (!fraction || !b.lastOpened) return false
  if (b.finished ?? fraction >= 0.98) return false
  if (b.resumeHiddenAt !== undefined && b.resumeHiddenAt >= b.lastOpened) return false
  return !(fraction <= RESUME_MIN_FRACTION && now - b.lastOpened > RESUME_STALE_DAYS * 86_400_000)
}

type Sized = Pick<BookMeta, 'id' | 'kind' | 'audio'>

/** compares by length, longest first: books by word count, audiobooks after them by duration */
export function byLength(lengths: ReadonlyMap<string, number>) {
  return (a: Sized, b: Sized) => {
    const audio = Number(a.kind === 'audio') - Number(b.kind === 'audio')
    if (audio) return audio
    if (a.kind === 'audio') return (b.audio?.duration ?? 0) - (a.audio?.duration ?? 0)
    return (lengths.get(b.id) ?? 0) - (lengths.get(a.id) ?? 0)
  }
}

/** ids of the LONGEST_COUNT longest books, audiobooks left out (their length is time, not words) */
export function longestOf(books: Sized[], lengths: ReadonlyMap<string, number>): Set<string> {
  const top = books.filter((b) => b.kind !== 'audio').sort(byLength(lengths)).slice(0, LONGEST_COUNT)
  return new Set(top.map((b) => b.id))
}
