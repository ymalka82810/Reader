import { beforeEach, describe, expect, it } from 'vitest'
import { keptLists, listsOf, rememberLists, rememberName, rememberWork } from './bookKnowledge'

beforeEach(() => localStorage.clear())

describe('the knowledge kept on the device', () => {
  it("gathers a series' books from the names saved, one entry for each number", () => {
    rememberName("פרסי ג'קסון 2 - ים המפלצות", 'ריק ריירדן')
    rememberName("פרסי ג'קסון 1 - גנב הברק", 'ריק ריירדן')
    rememberWork("פרסי ג'קסון", '2', 'ים המפלצות', 'ריק ריירדן')
    rememberWork("פרסי ג'קסון", '2', 'ים המפלצות המתוקן', 'ריק ריירדן')
    expect(keptLists()).toEqual([
      {
        series: "פרסי ג'קסון",
        from: 'library',
        author: 'ריק ריירדן',
        books: [
          { title: 'גנב הברק', number: '1' },
          { title: 'ים המפלצות המתוקן', number: '2' },
        ],
      },
    ])
  })

  it('keeps nothing of a name with no series, number or title', () => {
    rememberName('שם רגיל', 'מישהו')
    rememberName("פרסי ג'קסון 3", 'ריק ריירדן')
    expect(keptLists()).toEqual([])
  })

  it("gives the lists of the author, or of none, from the sources asked", () => {
    rememberLists([{ series: 'א', books: [{ title: 'x', number: '1' }] }], 'ריק ריירדן')
    rememberLists([{ series: 'ב', books: [{ title: 'y', number: '1' }] }], 'מישהו אחר', 'wikidata')
    rememberLists([{ series: 'ג', books: [{ title: 'z', number: '1' }] }], '', 'wikidata')
    expect(listsOf('ריק ריירדן').map((l) => l.series)).toEqual(['א', 'ג'])
    expect(listsOf('ריק ריירדן', [undefined]).map((l) => l.series)).toEqual(['א'])
    expect(listsOf('ריק ריירדן', ['wikidata']).map((l) => l.series)).toEqual(['ג'])
  })
})
