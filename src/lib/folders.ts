import type { BookMeta } from './db'
import { localeTag } from '../i18n'

export interface Folder {
  /** identity ignoring case and nikud/accents; '' is the "no author" folder */
  key: string
  /** the name to show; '' for the "no author" folder */
  name: string
  books: BookMeta[]
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
/** nikud and accents are dropped so "משה" and "מֹשֶׁה" land in the same folder */
const keyOf = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('he')

/** A book's folder name: the one the user picked (an empty pick means "no folder"), otherwise its author. */
export const folderName = (b: Pick<BookMeta, 'author' | 'folder'>) => clean(b.folder ?? b.author)

export const folderKey = (b: Pick<BookMeta, 'author' | 'folder'>) => keyOf(folderName(b))

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
