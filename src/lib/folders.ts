import type { BookMeta } from './db'
import { localeTag } from '../i18n'
import { decodeEntities } from './entities'
import { authorsIn } from './authorList'

export interface Folder {
  /** identity ignoring case and nikud/accents; '' is the "no author" folder */
  key: string
  /** the name to show; '' for the "no author" folder */
  name: string
  books: BookMeta[]
}

/** the name as it is shown: invisible direction and joining marks (RLM, LRM, ZWJ, a BOM), which Hebrew metadata often
 *  carries, are dropped, and the letters are in one Unicode form, so two names that look the same are the same */
const clean = (s: string | undefined) =>
  decodeEntities(s ?? '')
    .replace(/\p{Cf}/gu, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
/** nikud and accents are dropped so "משה" and "מֹשֶׁה" land in the same folder, the geresh and the apostrophe, the
 *  gershayim and the quote, the maqaf and the hyphen are one, a dot is followed by one space ("ג'.ק." is "ג'. ק."), and
 *  the authors of a shared book are put in order so "א, ב" and "ב, א" are one folder */
const keyOf = (name: string) => {
  const k = clean(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[׳’‘`´]/gu, "'")
    .replace(/[״“”„]/gu, '"')
    .replace(/[־‐‑–—]/gu, '-')
    .replace(/\.\s*(?=\S)/gu, '. ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('he')
  const authors = authorsIn(k)
  return authors.length > 1 ? authors.sort().join(', ') : k
}

/** A book's folder name: the one the user picked (an empty pick means "no folder"), otherwise its author. */
export const folderName = (b: Pick<BookMeta, 'author' | 'folder'>) => clean(b.folder ?? b.author)

export const folderKey = (b: Pick<BookMeta, 'author' | 'folder'>) => keyOf(folderName(b))

/** the folder key of a name as it stands (a folder's name on the phone): two names with one key are one folder */
export const folderKeyOfName = (name: string) => keyOf(name)

/** Groups books into folders: named folders alphabetically, the "no author" folder last. Book order inside is kept. */
export function groupFolders(books: BookMeta[]): Folder[] {
  const map = new Map<string, Folder>()
  for (const b of books) {
    const name = folderName(b)
    const key = keyOf(name)
    const f = map.get(key)
    if (f) {
      f.books.push(b)
      // show the plainest spelling (the one with the fewest marks)
      if (name.normalize('NFD').length < f.name.normalize('NFD').length) f.name = name
    } else map.set(key, { key, name, books: [b] })
  }
  return [...map.values()].sort((a, b) =>
    !a.key ? 1 : !b.key ? -1 : a.name.localeCompare(b.name, localeTag()),
  )
}

/** The value to store when moving a book into the folder `name`: nothing when that is simply where its author puts it. */
export const folderToStore = (b: Pick<BookMeta, 'author'>, name: string): string | undefined => {
  const n = clean(name)
  return keyOf(n) === keyOf(clean(b.author)) ? undefined : n
}

export type FolderSort = 'recent' | 'added' | 'title' | 'author' | 'longest' | 'loved'

/**
 * Orders the folder list the way the sort picker says. A folder holding a single author's only book is shown as that book
 * (`loose`), so it sorts by the book's title; a real folder sorts by its name. The "no author" folder goes last when sorting
 * by name. `foldersFirst` puts the real folders before the loose books, or after them.
 */
export function sortFolders(folders: Folder[], loose: Set<string>, sort: FolderSort, foldersFirst: boolean): Folder[] {
  const opened = (b: BookMeta) => b.lastOpened ?? b.addedAt
  const newest = (f: Folder, at: (b: BookMeta) => number) => f.books.reduce((m, b) => Math.max(m, at(b)), 0)
  const label = (f: Folder) => (sort === 'title' && loose.has(f.key) ? f.books[0]!.title : f.name)
  const byName = (a: Folder, b: Folder) => (!a.key ? 1 : !b.key ? -1 : label(a).localeCompare(label(b), localeTag()))
  const byDate = (at: (b: BookMeta) => number) => (a: Folder, b: Folder) => newest(b, at) - newest(a, at) || byName(a, b)
  // "loved most": the folder's best-rated book decides; unrated folders by name after the rated ones
  const order =
    sort === 'recent' ? byDate(opened) : sort === 'added' ? byDate((b) => b.addedAt) : sort === 'loved' ? byDate((b) => b.rating ?? 0) : byName
  const sorted = [...folders].sort(order)
  const real = sorted.filter((f) => !loose.has(f.key))
  const single = sorted.filter((f) => loose.has(f.key))
  return foldersFirst ? [...real, ...single] : [...single, ...real]
}
