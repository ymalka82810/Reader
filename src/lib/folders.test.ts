import { describe, expect, it } from 'vitest'
import type { BookMeta } from './db'
import { folderName, folderToStore, groupFolders, sortFolders } from './folders'

const book = (id: string, author: string, folder?: string) =>
  ({ id, title: id, author, folder }) as unknown as BookMeta

describe('folders', () => {
  it('groups by author, ignoring case and spacing, with no-author last', () => {
    const f = groupFolders([book('a', 'ב'), book('b', ''), book('c', ' א  '), book('d', 'ב')])
    expect(f.map((x) => [x.name, x.books.map((b) => b.id)])).toEqual([
      ['א', ['c']],
      ['ב', ['a', 'd']],
      ['', ['b']],
    ])
  })

  it('ignores nikud, showing the plain spelling', () => {
    const f = groupFolders([book('a', 'מֹשֶׁה'), book('b', 'משה'), book('c', 'מֹשה')])
    expect(f.map((x) => [x.name, x.books.map((b) => b.id)])).toEqual([['משה', ['a', 'b', 'c']]])
    expect(folderToStore({ author: 'מֹשֶׁה' }, 'משה')).toBeUndefined()
  })

  it('a chosen folder overrides the author, and an empty choice means no folder', () => {
    expect(folderName(book('a', 'ב', 'סדרה'))).toBe('סדרה')
    expect(folderName(book('a', 'ב', ''))).toBe('')
    const f = groupFolders([book('a', 'ב', 'סדרה'), book('b', 'סדרה')])
    expect(f).toHaveLength(1)
  })

  it('stores nothing when the target is the author folder', () => {
    expect(folderToStore({ author: 'ב' }, 'ב')).toBeUndefined()
    expect(folderToStore({ author: 'ב' }, 'ג')).toBe('ג')
    expect(folderToStore({ author: 'ב' }, '')).toBe('')
    expect(folderToStore({ author: '' }, '')).toBeUndefined()
  })

  describe('sortFolders', () => {
    const dated = (id: string, author: string, addedAt: number, lastOpened?: number, title = id) =>
      ({ id, title, author, addedAt, lastOpened }) as unknown as BookMeta
    const folders = groupFolders([
      dated('x1', 'ב', 10, 50),
      dated('x2', 'ב', 20),
      dated('y', 'א', 30, undefined, 'תפוח'),
      dated('z', 'ג', 5, 90, 'אגס'),
      dated('n', '', 40),
    ])
    const loose = new Set(['א', 'ג'])
    const names = (sort: Parameters<typeof sortFolders>[2], first = true) =>
      sortFolders(folders, loose, sort, first).map((f) => f.name)

    it('sorts by name with the no-author folder last, folders above the single books', () => {
      expect(names('author')).toEqual(['ב', '', 'א', 'ג'])
    })
    it('puts the folders below the single books when asked', () => {
      expect(names('author', false)).toEqual(['א', 'ג', 'ב', ''])
    })
    it('sorts a single book by its title', () => {
      expect(names('title', false)).toEqual(['ג', 'א', 'ב', ''])
    })
    it('sorts by the newest book opened or added in each folder', () => {
      expect(names('recent', false)).toEqual(['ג', 'א', 'ב', ''])
      expect(names('added', false)).toEqual(['א', 'ג', '', 'ב'])
    })
  })
})
