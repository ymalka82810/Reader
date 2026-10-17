import type { BookMeta } from './db'
import { t } from '../i18n'

export type ReadState = 'all' | 'reading' | 'unread' | 'finished'

/** what the library list is narrowed to; every part that is set must match */
export interface LibraryFilter {
  state: ReadState
  /** file type from bookType(); '' = any */
  type: string
  /** folder key; undefined = any folder */
  folder?: string
  /** ids of hand-picked books; empty = no pick */
  ids: ReadonlySet<string>
}

export const NO_FILTER: LibraryFilter = { state: 'all', type: '', ids: new Set() }

export const isFiltering = (f: LibraryFilter) =>
  f.state !== 'all' || !!f.type || f.folder !== undefined || f.ids.size > 0

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
