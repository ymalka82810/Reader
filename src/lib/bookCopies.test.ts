import { afterEach, describe, expect, it } from 'vitest'
import { copyGroups, keeperOf, markNotCopies, mergeCopies, sameCopy } from './bookCopies'
import { getBookMeta, getNotes, mergedInto, saveBook, saveNotes, updateProgress, type BookRecord } from './db'

const b = (id: string, title: string, author = '', kind: 'epub' | 'pdf' = 'epub', more: Partial<BookRecord> = {}) => ({ id, title, author, kind, addedAt: 1, ...more })

afterEach(() => localStorage.clear())

describe('sameCopy', () => {
  it('finds one book under its name in the template and its bare title, and across spellings of the author', () => {
    expect(sameCopy(b('a', "מגנוס צ'ייס 3 - ספינת המתים", 'ריק ריירדן', 'pdf'), b('b', "מגנוס צ'ייס 3 - ספינת המתים", 'Rick Riordan'))).toBe(true)
    expect(sameCopy(b('a', "פרסי ג'קסון 1 - גנב הברק", 'ריק ריירדן'), b('b', 'גנב הברק', 'ריק ריירדן'))).toBe(true)
  })
  it('keeps apart two numbers or series sharing a title, other authors, a short title with no author, and audiobooks', () => {
    expect(sameCopy(b('a', 'סדרה 1 - ההתחלה', 'א ב'), b('b', 'סדרה 2 - ההתחלה', 'א ב'))).toBe(false)
    expect(sameCopy(b('a', 'סדרה 1 - ההתחלה'), b('b', 'אחרת 1 - ההתחלה'))).toBe(false)
    expect(sameCopy(b('a', 'הבחירה', 'קיארה קאס'), b('b', 'הבחירה', 'לויס לורי'))).toBe(false)
    expect(sameCopy(b('a', 'מבוא'), b('b', 'מבוא'))).toBe(false)
    expect(sameCopy({ ...b('a', 'ספינת המתים הגדולה'), kind: 'audio' }, b('b', 'ספינת המתים הגדולה'))).toBe(false)
  })
  it('groups copies, and not those the user said are different books', () => {
    const books = [b('a', 'גנב הברק הגדול'), b('b', 'גנב הברק הגדול', '', 'pdf'), b('c', 'משהו אחר לגמרי')]
    expect(copyGroups(books).map((g) => g.map((x) => x.id))).toEqual([['a', 'b']])
    markNotCopies(copyGroups(books))
    expect(copyGroups(books)).toEqual([])
  })
})

describe('merging', () => {
  const rec = (id: string, kind: 'epub' | 'pdf', more: Partial<BookRecord> = {}): BookRecord => ({
    ...b(id, 'ספינת המתים של מגנוס', 'ריק ריירדן', kind),
    file: new Blob([id]),
    fileName: `${id}.${kind}`,
    ...more,
  })

  it('keeps the copy read, then an EPUB over a PDF', async () => {
    expect((await keeperOf([b('p', 'x', '', 'pdf'), b('e', 'x')])).id).toBe('e')
    expect((await keeperOf([b('p', 'x', '', 'pdf', { fraction: 0.4 }), b('e', 'x')])).id).toBe('p')
  })

  it("deletes the other copy, moving its notes, place, tags and read mark, and remembers where its file went", async () => {
    await saveBook(rec('k', 'epub', { tags: ['א'] }))
    await saveBook(rec('d', 'epub', { tags: ['ב'], finished: true }))
    await saveNotes('k', [{ id: '1', kind: 'highlight', cfi: 'c1', text: 'x', color: 'y', createdAt: 1 }])
    await saveNotes('d', [
      { id: '2', kind: 'highlight', cfi: 'c2', text: 'z', color: 'y', createdAt: 2 },
      { id: '3', kind: 'highlight', cfi: 'c1', text: 'x', color: 'y', createdAt: 3 },
    ])
    await updateProgress('d', 'cfi-d', 0.3)
    expect(await mergeCopies([[b('k', 'ספינת המתים של מגנוס'), b('d', 'ספינת המתים של מגנוס')]])).toBe(1)
    expect(await getBookMeta('d')).toBeUndefined()
    expect(await mergedInto('d')).toBe('k')
    expect((await getNotes('k')).map((n) => n.cfi)).toEqual(['c1', 'c2'])
    expect(await getBookMeta('k')).toMatchObject({ tags: ['א', 'ב'], finished: true })
  })
})

it('counts the groups set apart and offers them again once taken back', async () => {
  const { copyGroups, markNotCopies, notCopiesCount, clearNotCopies } = await import('./bookCopies')
  const books = [
    { id: 'a', title: 'פרסי ג\'קסון 1 - גנב הברק', author: 'ריק ריירדן', kind: 'epub' as const },
    { id: 'b', title: 'פרסי ג\'קסון 1 - גנב הברק', author: 'Rick Riordan', kind: 'pdf' as const },
  ]
  markNotCopies(copyGroups(books))
  expect(copyGroups(books)).toEqual([])
  expect(notCopiesCount(books)).toBe(1)
  clearNotCopies()
  expect(copyGroups(books)).toHaveLength(1)
})
