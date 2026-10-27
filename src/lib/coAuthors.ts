// Links between the folder of a shared book ("א, ב") and the folders of each of its authors alone. The shared books
// live in their own folder; each author's folder links to it ("יחד עם ב׳") and it links back to each author ("עוד מ-א׳").
// An author with one book is shown as that book (loose), so a link to them opens the book, and that book's card links to
// the shared folder. A shared folder of one book (loose too) gets no links in the library: the end of the book offers
// the authors instead (moreByAuthors).
import type { BookMeta } from './db'
import { authorsIn } from './authorList'
import { folderKey, folderName, groupFolders, type Folder } from './folders'

export interface FolderLink {
  /** the folder linked to */
  key: string
  /** 'joint': a shared folder (names = the other authors); 'author': one author's own books (names = that author) */
  kind: 'joint' | 'author'
  names: string
  n: number
  /** a folder shown as its one book opens that book */
  book?: string
}

const keyOfAuthor = (a: string) => folderKey({ author: a })

/** the links shown with `folder` (a folder being viewed, or a loose book's folder) */
export function folderLinks(folder: Folder, all: Folder[], loose: Set<string>): FolderLink[] {
  if (!folder.key) return []
  const authors = authorsIn(folder.name)
  const byKey = new Map(all.map((f) => [f.key, f]))
  if (authors.length > 1) {
    if (loose.has(folder.key)) return []
    return authors.flatMap((a): FolderLink[] => {
      const f = byKey.get(keyOfAuthor(a))
      if (!f?.books.length) return []
      return [{ key: f.key, kind: 'author', names: f.name || a, n: f.books.length, book: loose.has(f.key) ? f.books[0]!.id : undefined }]
    })
  }
  return all.flatMap((j): FolderLink[] => {
    if (!j.books.length || loose.has(j.key)) return []
    const names = authorsIn(j.name)
    if (names.length < 2 || !names.some((a) => keyOfAuthor(a) === folder.key)) return []
    const others = names.filter((a) => keyOfAuthor(a) !== folder.key)
    return [{ key: j.key, kind: 'joint', names: others.join(', '), n: j.books.length }]
  })
}

/** for the end of a shared book: each of its authors' own books in the library (a folder, or the one book) */
export function moreByAuthors(book: BookMeta, books: BookMeta[]): FolderLink[] {
  const authors = authorsIn(folderName(book))
  if (authors.length < 2) return []
  const folders = new Map(groupFolders(books.filter((b) => b.id !== book.id)).map((f) => [f.key, f]))
  return authors.flatMap((a): FolderLink[] => {
    const f = folders.get(keyOfAuthor(a))
    if (!f?.books.length) return []
    const one = f.books.length === 1 && f.books[0]!.folder === undefined
    return [{ key: f.key, kind: 'author', names: f.name || a, n: f.books.length, book: one ? f.books[0]!.id : undefined }]
  })
}
