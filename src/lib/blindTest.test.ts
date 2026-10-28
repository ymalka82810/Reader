import { beforeEach, expect, it } from 'vitest'
import { blindDue, blindReport, compare, runBlindTest } from './blindTest'
import { listsOf } from './bookKnowledge'
import type { BookMeta } from './db'
import { confirmName } from './identifyLearning'

beforeEach(() => localStorage.clear())

const book = (id: string, title: string, fileName: string, author = 'דנה כהן'): BookMeta =>
  ({ id, title, author, kind: 'epub', fileName, addedAt: 0 }) as BookMeta

const meta = (title: string) => ({ title, authors: ['דנה כהן'], series: '', number: '', identifiers: [] })

it('compares a name part by part, the number only in a series and the author only when given', () => {
  expect(compare({ title: 'הים 2 - גל', author: 'דנה כהן' }, { series: 'הים', number: '02', title: 'גל', author: 'דנה כהן' })).toEqual({
    parts: { series: true, number: true, title: true, author: true },
    whole: true,
  })
  expect(compare({ title: 'גל', author: '' }, { series: 'הים', number: '2', title: 'גל', author: 'x' })).toEqual({ parts: { series: false, title: true }, whole: false })
})

it('identifies a named book again as new, with its own name hidden from the library, and keeps how it did', async () => {
  const books = [
    book('a', 'הים 1 - גל ראשון', 'הים 1 - גל ראשון.epub'),
    book('b', 'הים 2 - גל שני', 'x.epub'),
    book('c', 'ספר בודד', 'y.epub'),
  ]
  for (const b of books) confirmName(b.id, b.title, b.author)
  const seen: Record<string, string[]> = {}
  const n = await runBlindTest(books, undefined, {
    details: async (b) => {
      // while the book is tested, the name the user gave it is not among the library's names
      seen[b.id] = listsOf('דנה כהן').flatMap((l) => l.books.map((x) => x.title))
      return { opening: [], meta: meta(b.id === 'b' ? 'גל שני' : b.id === 'a' ? 'גל ראשון' : 'ספר בודד') }
    },
  })
  expect(n).toBe(3)
  const r = blindReport(books)
  expect(r.books).toBe(3)
  // the file's name gives book a its place; b came with a bare title only
  expect(r.parts.title).toEqual({ right: 3, of: 3 })
  expect(r.parts.series.of).toBe(3)
  expect(r.parts.series.right).toBeGreaterThanOrEqual(2)
  expect(blindDue()).toBe(false)
  // and what it found teaches the clues, once per book
  expect(Object.keys(JSON.parse(localStorage.getItem('reader:identify:blind-learnt') ?? '{}')).length).toBeGreaterThan(0)
  expect(listsOf('דנה כהן').flatMap((l) => l.books.map((x) => x.title))).toContain('גל ראשון')
  expect(seen.a).not.toContain('גל ראשון')
  expect(seen.a).toContain('גל שני')
})

it('counts only books still named as the user named them', async () => {
  const books = [book('a', 'גל', 'x.epub')]
  confirmName('a', 'גל', 'דנה כהן')
  await runBlindTest(books, undefined, { details: async () => ({ opening: [], meta: meta('גל') }) })
  expect(blindReport(books).books).toBe(1)
  expect(blindReport([{ id: 'a', title: 'אחר' }]).books).toBe(0)
})
