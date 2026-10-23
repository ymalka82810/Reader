import { expect, it } from 'vitest'
import { libraryHealth } from './seriesHealth'

const b = (id: string, title: string, author = 'ריק ריירדן') => ({ id, title, author })

it('finds two books with one number, but not two copies of one book', () => {
  const issues = libraryHealth([b('1', "פרסי ג'קסון 1 - גנב הברק"), b('2', "פרסי ג'קסון 1 - ים המפלצות"), b('3', "פרסי ג'קסון 2 - ים המפלצות"), b('4', "פרסי ג'קסון 2 - ים המפלצות")])
  expect(issues.filter((i) => i.kind === 'duplicate')).toEqual([{ kind: 'duplicate', series: "פרסי ג'קסון", number: 1, books: [b('1', "פרסי ג'קסון 1 - גנב הברק"), b('2', "פרסי ג'קסון 1 - ים המפלצות")] }])
})

it("finds a series by two authors, but not a co-author's name or another spelling", () => {
  const books = [b('1', 'מגיסטריום 1 - א', 'הולי בלק וקסנדרה קלייר'), b('2', 'מגיסטריום 2 - ב', 'הולי בלק'), b('3', 'מגיסטריום 3 - ג', 'Holly Black & Cassandra Clare')]
  expect(libraryHealth(books).some((i) => i.kind === 'authors')).toBe(false)
  expect(libraryHealth([...books, b('4', 'מגיסטריום 4 - ד', 'ריק ריירדן')]).find((i) => i.kind === 'authors')).toMatchObject({ authors: ['הולי בלק וקסנדרה קלייר', 'ריק ריירדן'] })
})

it('finds one author under several spellings, the most common first', () => {
  const issues = libraryHealth([b('1', 'א', "ג'יי קיי רולינג"), b('2', 'ב', "ג'יי קיי רולינג"), b('3', 'ג', 'J.K. Rowling'), b('4', 'ד', 'הולי בלק'), b('5', 'ה', 'הולי בלק וקסנדרה קלייר')])
  expect(issues).toEqual([{ kind: 'author', main: "ג'יי קיי רולינג", others: ['J.K. Rowling'], books: 3 }])
})

it('finds one series under several spellings, the most common first, but not two series of other authors', () => {
  const books = [b('1', 'מגיסטריום 1 - א'), b('2', 'מגיסטריום 2 - ב'), b('3', 'Magisterium 3 - ג')]
  expect(libraryHealth(books).find((i) => i.kind === 'series')).toEqual({ kind: 'series', main: 'מגיסטריום', others: ['Magisterium'], books: [b('3', 'Magisterium 3 - ג')] })
  expect(libraryHealth([...books.slice(0, 2), b('3', 'Magisterium 3 - ג', 'הולי בלק')]).some((i) => i.kind === 'series')).toBe(false)
})

it('finds the numbers a series is missing, but not for a long series the library has the end of', () => {
  expect(libraryHealth([b('1', 'ס 1 - א'), b('2', 'ס 4 - ב')])).toEqual([{ kind: 'gap', series: 'ס', missing: [2, 3] }])
  expect(libraryHealth([b('1', 'ס 55 - א'), b('2', 'ס 56 - ב')])).toEqual([])
})
