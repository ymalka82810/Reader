import { describe, expect, it } from 'vitest'
import type { BookMeta } from './db'
import { folderName, folderToStore, groupFolders } from './folders'

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
})
