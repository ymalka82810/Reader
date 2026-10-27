import { describe, expect, it } from 'vitest'
import type { BookMeta } from './db'
import { folderLinks, moreByAuthors } from './coAuthors'
import { folderKey, groupFolders } from './folders'

let n = 0
const book = (author: string, title = `t${n}`): BookMeta => ({ id: `b${n++}`, title, author, kind: 'epub', fileName: 'x.epub', addedAt: n }) as BookMeta
const looseOf = (folders: ReturnType<typeof groupFolders>) =>
  new Set(folders.filter((f) => f.books.length === 1 && f.books[0]!.folder === undefined).map((f) => f.key))
const find = (folders: ReturnType<typeof groupFolders>, name: string) => folders.find((f) => f.key === folderKey({ author: name }))!

describe('co-authors', () => {
  it('puts "א, ב" and "ב, א" in one folder', () => {
    expect(groupFolders([book('ניל גיימן, טרי פראצט'), book('טרי פראצט, ניל גיימן')])).toHaveLength(1)
  })

  it('links a shared folder and its authors both ways', () => {
    const books = [book('ניל גיימן'), book('ניל גיימן'), book('טרי פראצט'), book('ניל גיימן, טרי פראצט'), book('טרי פראצט, ניל גיימן')]
    const all = groupFolders(books)
    const loose = looseOf(all)
    const joint = find(all, 'ניל גיימן, טרי פראצט')
    expect(folderLinks(joint, all, loose)).toEqual([
      { key: find(all, 'ניל גיימן').key, kind: 'author', names: 'ניל גיימן', n: 2, book: undefined },
      // one book of his own: the link opens it
      { key: find(all, 'טרי פראצט').key, kind: 'author', names: 'טרי פראצט', n: 1, book: books[2]!.id },
    ])
    expect(folderLinks(find(all, 'ניל גיימן'), all, loose)).toEqual([{ key: joint.key, kind: 'joint', names: 'טרי פראצט', n: 2 }])
    // the loose book of an author links to the shared folder too
    expect(folderLinks(find(all, 'טרי פראצט'), all, loose)).toEqual([{ key: joint.key, kind: 'joint', names: 'ניל גיימן', n: 2 }])
  })

  it('a single shared book gets no links in the library, only at its end', () => {
    const books = [book('ניל גיימן'), book('ניל גיימן'), book('טרי פראצט'), book('ניל גיימן, טרי פראצט')]
    const all = groupFolders(books)
    const loose = looseOf(all)
    expect(folderLinks(find(all, 'ניל גיימן'), all, loose)).toEqual([])
    expect(folderLinks(find(all, 'ניל גיימן, טרי פראצט'), all, loose)).toEqual([])
    expect(moreByAuthors(books[3]!, books).map((l) => [l.names, l.n, l.book])).toEqual([
      ['ניל גיימן', 2, undefined],
      ['טרי פראצט', 1, books[2]!.id],
    ])
    expect(moreByAuthors(books[0]!, books)).toEqual([])
  })
})
