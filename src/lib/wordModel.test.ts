import { beforeEach, expect, it } from 'vitest'
import { people } from './bookName'
import { norm } from './sameBook'
import { gazetteerOf, learnWords, splitLine, tagByName, tagWords, tokenize, wordsReport } from './wordModel'

beforeEach(() => localStorage.clear())

it('tokenizes words, initials and marks apart', () => {
  expect(tokenize("ג'יי קיי רולינג: הארי-פוטר (3)").map((t) => t.text)).toEqual(["ג'יי", 'קיי', 'רולינג', ':', 'הארי-פוטר', '(', '3', ')'])
  expect(tokenize('3.5 ת.ד. 163').map((t) => t.text)).toEqual(['3.5', 'ת.ד.', '163'])
})

it('splits a line that prints the series, the number, the title and the author', () => {
  expect(splitLine("הארי פוטר 3 והאסיר מאזקבאן מאת ג'יי קיי רולינג")).toEqual(['הארי פוטר', 'ספר 3', 'והאסיר מאזקבאן', "מאת ג'יי קיי רולינג"])
})

it('splits the title from the author at a colon or a cue, keeping the cue with the author', () => {
  expect(splitLine('ריק ריירדן: הפיתוי האפל')).toEqual(['ריק ריירדן', 'הפיתוי האפל'])
  expect(splitLine('המבוך הבוער מאת ריק ריירדן')).toEqual(['המבוך הבוער', 'מאת ריק ריירדן'])
})

it('splits the number out as a book line the line classifier reads', () => {
  expect(splitLine('ספר שלישי בסדרת הבחירה')).toEqual(['ספר שלישי', 'בסדרת הבחירה'])
})

it('leaves a credit, a publisher and a plain title as they are', () => {
  expect(splitLine('תרגום: דני כהן')).toEqual(['תרגום: דני כהן'])
  expect(splitLine('הוצאת כתר 2005')).toEqual(['הוצאת כתר 2005'])
  expect(splitLine('המבוך הבוער הגדול של הים')).toEqual(['המבוך הבוער הגדול של הים'])
  expect(splitLine('רח\' אגוז 6, פארק תעשיות חמן, חבל מודיעין 7319900')).toEqual(['רח\' אגוז 6, פארק תעשיות חמן, חבל מודיעין 7319900'])
})

it('tags the year apart from the number', () => {
  const tags = tagWords('הוצאת כתר 2005', {}, 0, undefined, {}).map((x) => x.tag)
  expect(tags[tags.length - 1]).toBe('year')
})

it('tags the words by the name a book is known to have', () => {
  const tags = tagByName('הארי פוטר 3 והאסיר מאזקבאן מאת ג\'יי קיי רולינג', { series: 'הארי פוטר', number: '3', title: 'והאסיר מאזקבאן' }, "ג'יי קיי רולינג")
  expect(tags).toEqual(['series', 'series', 'number', 'title', 'title', 'noise', 'author', 'author', 'author'])
  // a line none of the name is on says nothing, unless it is plainly not a name
  expect(tagByName('משהו אחר לגמרי', { title: 'גנב הברק' }, 'ריק ריירדן')).toBeUndefined()
  expect(tagByName('תרגום: דני כהן', { title: 'גנב הברק' }, 'ריק ריירדן')?.every((t) => t === 'noise')).toBe(true)
})

it('knows the names the library holds', () => {
  const g = gazetteerOf({ authors: ['ריק ריירדן'], series: ['פרסי ג\'קסון'] })
  expect(g.authors.has(people('ריק ריירדן'))).toBe(true)
  expect(g.series.has(norm("פרסי ג'קסון"))).toBe(true)
})

it('learns from the name the user gave, on the device', () => {
  expect(wordsReport()).toBe(0)
  learnWords(['נסיכת הקרח', 'מאת אסנת לב'], { title: 'נסיכת הקרח' }, 'אסנת לב')
  expect(wordsReport()).toBeGreaterThan(0)
  const before = wordsReport()
  // a line none of the name is on teaches nothing
  learnWords(['משהו אחר לגמרי'], { title: 'נסיכת הקרח' }, 'אסנת לב')
  expect(wordsReport()).toBe(before)
})
