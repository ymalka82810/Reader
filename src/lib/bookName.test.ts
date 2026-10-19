import { describe, expect, it } from 'vitest'
import { formatBookName, guessBookName, seriesOf, splitBookName, tidyBookName, withoutAuthor } from './bookName'

const EXAMPLES: [string, { series: string; number: string; title: string }][] = [
  ["פרסי ג'קסון 1 - גנב הברק", { series: "פרסי ג'קסון", number: '1', title: 'גנב הברק' }],
  ['הערפילאים 2 העידן הראשון - האימפריה האחרונה', { series: 'הערפילאים', number: '2 העידן הראשון', title: 'האימפריה האחרונה' }],
  [
    'שיר של אש ושל קרח 3 - סופת החרבות, חלק ראשון - פלדה ושלג',
    { series: 'שיר של אש ושל קרח', number: '3', title: 'סופת החרבות, חלק ראשון - פלדה ושלג' },
  ],
  ['הארי פוטר 1 - אבן החכמים', { series: 'הארי פוטר', number: '1', title: 'אבן החכמים' }],
]

describe('the naming template', () => {
  it('splits a name in the template and puts it back together unchanged', () => {
    for (const [name, parts] of EXAMPLES) {
      expect(splitBookName(name)).toEqual(parts)
      expect(formatBookName(parts)).toBe(name)
    }
  })

  it('names a book outside a series by its title alone', () => {
    expect(formatBookName({ series: '', number: '', title: ' גנב  הברק ' })).toBe('גנב הברק')
    expect(splitBookName('גנב הברק - ריק ריירדן')).toEqual({ series: '', number: '', title: 'גנב הברק - ריק ריירדן' })
  })

  it('keeps a series without a number', () => {
    expect(formatBookName({ series: "פרסי ג'קסון", number: '', title: 'גנב הברק' })).toBe("פרסי ג'קסון - גנב הברק")
  })

  it('does not take a year for a series number', () => {
    expect(splitBookName('מלחמת 1948 - סיפור').series).toBe('')
    expect(guessBookName('1984 - ג׳ורג׳ אורוול').series).toBe('')
  })
})

describe('guessBookName', () => {
  it('reads the template itself', () => {
    for (const [name, parts] of EXAMPLES) expect(guessBookName(name)).toEqual(parts)
  })

  it('reads a series in brackets after the title', () => {
    expect(guessBookName("גנב הברק (פרסי ג'קסון #1)")).toEqual({ series: "פרסי ג'קסון", number: '1', title: 'גנב הברק' })
    expect(guessBookName('The Final Empire (Mistborn, Book 1)')).toEqual({ series: 'Mistborn', number: '1', title: 'The Final Empire' })
    expect(guessBookName("גנב הברק [פרסי ג'קסון, ספר ראשון]")).toEqual({ series: "פרסי ג'קסון", number: '1', title: 'גנב הברק' })
  })

  it('reads "book N" between the series and the title', () => {
    expect(guessBookName("פרסי ג'קסון ספר 1: גנב הברק")).toEqual({ series: "פרסי ג'קסון", number: '1', title: 'גנב הברק' })
    expect(guessBookName("פרסי ג'קסון - ספר שני - ים המפלצות")).toEqual({ series: "פרסי ג'קסון", number: '2', title: 'ים המפלצות' })
  })

  it('reads "#N", a colon, leading zeros and underscores', () => {
    expect(guessBookName('Mistborn #1: The Final Empire')).toEqual({ series: 'Mistborn', number: '1', title: 'The Final Empire' })
    expect(guessBookName('הארי_פוטר_01_-_אבן_החכמים')).toEqual({ series: 'הארי פוטר', number: '1', title: 'אבן החכמים' })
  })

  it('leaves a title with "חלק" or "הספר" in it alone', () => {
    expect(guessBookName('סופת החרבות, חלק ראשון - פלדה ושלג').series).toBe('')
    expect(guessBookName('הספר השני: סיפור').series).toBe('')
  })

  it('is all title when there is no series in it', () => {
    expect(guessBookName('גנב הברק')).toEqual({ series: '', number: '', title: 'גנב הברק' })
  })
})

describe('seriesOf', () => {
  it('reads the forms a catalog uses', () => {
    expect(seriesOf("פרסי ג'קסון, ספר 1")).toEqual({ series: "פרסי ג'קסון", number: '1' })
    expect(seriesOf("פרסי ג'קסון והאולימפיים #3")).toEqual({ series: "פרסי ג'קסון והאולימפיים", number: '3' })
    expect(seriesOf("ספר ראשון בסדרת פרסי ג'קסון")).toEqual({ series: "פרסי ג'קסון", number: '1' })
    expect(seriesOf('Book 2 of the Mistborn')).toEqual({ series: 'Mistborn', number: '2' })
    expect(seriesOf('The Book Thief')).toBeUndefined()
    expect(seriesOf('רומן')).toBeUndefined()
  })
})

describe('withoutAuthor', () => {
  it('drops the author from either end of a file name', () => {
    expect(withoutAuthor('גנב הברק - ריק ריירדן', 'ריק ריירדן')).toBe('גנב הברק')
    expect(withoutAuthor('ריק ריירדן - גנב הברק', 'ריק ריירדן')).toBe('גנב הברק')
    expect(withoutAuthor('גנב הברק - ריק ריירדן', '')).toBe('גנב הברק - ריק ריירדן')
    expect(withoutAuthor('פלדה - ושלג', 'ריק ריירדן')).toBe('פלדה - ושלג')
  })
})

describe('tidyBookName', () => {
  it.each([
    ['עותק של משפחה קיין 1', 'משפחה קיין 1'],
    ['Copy of גנב הברק (1)', 'גנב הברק'],
    ['הנבואה האפלה (The Dark Prophecy)', 'הנבואה האפלה'],
    ['גורלו של אפולו 1, האורקל הנסתר', 'גורלו של אפולו 1 - האורקל הנסתר'],
    ['The Trials of Apollo 4 - גורלו של אפולו 4, קברו של הרוח', 'גורלו של אפולו 4 - קברו של הרוח'],
    ['המגדל של נירון', 'המגדל של נירון'],
  ])('%s -> %s', (from, to) => {
    expect(tidyBookName(from)).toBe(to)
  })
})
