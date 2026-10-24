// One author under several spellings splits the author's books between folders (the folder is the author): the
// library's check-up lists it, and this puts it right, every book taking the spelling most of the author's books have.
import { listBooks, renameFolder, updateMeta, type BookMeta } from './db'
import { libraryHealth } from './seriesHealth'

/** `main` becomes the author of every book written under one of `others` (and a folder of that name goes with it) */
export async function mergeAuthorSpellings(books: BookMeta[], main: string, others: string[]): Promise<void> {
  for (const other of others) {
    for (const b of books) if (b.author.trim() === other) await updateMeta(b.id, b.title, main)
    if (books.some((b) => b.folder?.trim() === other)) await renameFolder(other, main, true)
  }
}

/** every author spelt several ways in the library, put right at once; resolves with how many authors were merged */
export async function mergeAllAuthorSpellings(): Promise<number> {
  const books = await listBooks()
  let n = 0
  for (const i of libraryHealth(books)) {
    if (i.kind !== 'author') continue
    await mergeAuthorSpellings(books, i.main, i.others)
    n++
  }
  return n
}
