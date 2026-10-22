import { describe, expect, it } from 'vitest'
import { bookNumber, copyrightYear, inLists, namesIn, seriesByNames, seriesLists, librarySeriesFor, numberByGaps, originalSeries, originalSeriesName, soundOf, titleCase } from './bookInference'
import { norm } from './sameBook'

describe('soundOf', () => {
  it('sounds the same in Latin and Hebrew letters', () => {
    expect(soundOf('MAGISTERIUM')).toBe(soundOf('מגיסטריום'))
    expect(soundOf('Percy Jackson')).toBe(soundOf("פרסי ג'קסון"))
    expect(soundOf('Throne of Glass')).not.toBe(soundOf('מגיסטריום'))
  })
})

describe('bookNumber', () => {
  it('reads Roman and Arabic numbers', () => {
    expect(bookNumber('V')).toBe(5)
    expect(bookNumber('IV')).toBe(4)
    expect(bookNumber('XII')).toBe(12)
    expect(bookNumber('7')).toBe(7)
    expect(bookNumber('MMXIV')).toBeUndefined()
  })
})

// the copyright page of the Hebrew "מגדל הזהב", as its PDF has it
const golden = [
  'Holly Black and Cassandra Clare',
  'THE GOLDEN TOWER',
  'MAGISTERIUM V',
  'Copyright © 2018 by Holly Black and Cassandra Clare LLC',
  'Illustrations copyright © 2018 by Scott Fischer',
  'כל הזכויות שמורות',
  'ISBN 978-965-566-939-8 מסת"ב',
]

describe('originalSeries', () => {
  it('finds the original series and number on a copyright page', () => {
    expect(originalSeries(golden)).toEqual({ series: 'MAGISTERIUM', number: '5', title: 'THE GOLDEN TOWER' })
    expect(originalSeries(['Throne of Glass, Book 4'])).toEqual({ series: 'Throne of Glass', number: '4' })
  })
  it('takes no copyright, year or Hebrew line for one', () => {
    expect(originalSeries(['Copyright © 2014 by Holly Black', 'All Rights Reserved', 'פרק 1'])).toBeUndefined()
  })
})

describe('librarySeriesFor', () => {
  const series = [
    { name: 'מגיסטריום', authors: new Set([norm('הולי בלק וקסנדרה קלייר')]) },
    { name: "פרסי ג'קסון", authors: new Set([norm('ריק ריירדן')]) },
  ]
  it('names the original series as the library does, for the same author', () => {
    expect(librarySeriesFor('MAGISTERIUM', 'הולי בלק וקסנדרה קלייר', series, norm)).toBe('מגיסטריום')
    expect(librarySeriesFor('MAGISTERIUM', 'סופר אחר', series, norm)).toBeUndefined()
    expect(librarySeriesFor('The Hunger Games', 'הולי בלק וקסנדרה קלייר', series, norm)).toBeUndefined()
  })
})

describe('titleCase', () => {
  it('turns an all-capitals title into a name', () => {
    expect(titleCase('THE GOLDEN TOWER')).toBe('The Golden Tower')
    expect(titleCase('The Iron Trial')).toBe('The Iron Trial')
  })
})

describe('copyrightYear', () => {
  it('takes the original\'s year, not the Hebrew edition\'s', () => {
    expect(copyrightYear(['Hebrew Language Copyright © 2019 Kinneret', 'Copyright © 2018 by Holly Black and Cassandra Clare LLC'])).toBe(2018)
    expect(copyrightYear(['© תשע"ה 2015 כנרת'])).toBe(2015)
    expect(copyrightYear(['פרק 1', 'שנת 2018'])).toBeUndefined()
  })
})

describe('numberByGaps', () => {
  it('takes the one number missing, or the next', () => {
    expect(numberByGaps([{ number: 1 }, { number: 3 }])).toBeUndefined() // 2 or 4
    expect(numberByGaps([{ number: 1 }, { number: 2 }, { number: 3 }])).toBe(4)
  })
  it('decides between the gaps by the years', () => {
    const series = [
      { number: 1, year: 2014 },
      { number: 3, year: 2016 },
      { number: 4, year: 2017 },
    ]
    expect(numberByGaps(series, 2018)).toBe(5)
    expect(numberByGaps(series, 2015)).toBe(2)
    expect(numberByGaps(series)).toBeUndefined()
  })
})

describe('originalSeriesName', () => {
  const series = [{ name: 'מגיסטריום', authors: new Set([norm('הולי בלק וקסנדרה קלייר')]) }]
  it('finds the series named alone, in Latin or Hebrew letters', () => {
    expect(originalSeriesName(['THE GOLDEN TOWER', 'MAGISTERIUM'], 'הולי בלק וקסנדרה קלייר', series, norm)).toBe('מגיסטריום')
    expect(originalSeriesName(['מגיסטריום', 'מגדל הזהב'], 'הולי בלק וקסנדרה קלייר', series, norm)).toBe('מגיסטריום')
    expect(originalSeriesName(['מגיסטריון חדש'], 'הולי בלק וקסנדרה קלייר', series, norm)).toBeUndefined()
  })
})

describe('namesIn', () => {
  it('counts the names a story repeats, with their prefixed forms, and leaves common words and the credits out', () => {
    const lines = [
      'קאל הלך עם ארון אל המגיסטריום והוא אמר שזה בסדר',
      'וקאל חשב על טמרה ועל ארון כל הדרך אל החדר שלו',
      'לקאל לא היה מה לומר לטמרה והוא שתק עוד רגע ארוך',
      '© כל הזכויות שמורות לכנרת זמורה דביר מוציאים לאור בעמ',
    ]
    const names = Object.fromEntries(namesIn(lines))
    expect(names).toMatchObject({ קאל: 3, ארון: 2, טמרה: 2 })
    expect(names).not.toHaveProperty('אמר')
    expect(names).not.toHaveProperty('כנרת')
  })
})

describe('seriesByNames', () => {
  const book: [string, number][] = ['קאל', 'ארון', 'טמרה', "ג'ספר", 'רופוס', 'קוסם'].map((w) => [w, 10])
  it('takes the series that shares four names or more, clearly more than another', () => {
    const magisterium = { name: 'מגיסטריום', books: [['קאל', 'ארון', 'טמרה', "ג'ספר", 'מאסטר'].map((w): [string, number] => [w, 5])] }
    const other = { name: 'סדרה אחרת', books: [['קוסם', 'דרקון', 'מלך'].map((w): [string, number] => [w, 5])] }
    expect(seriesByNames(book, [magisterium, other])).toBe('מגיסטריום')
    expect(seriesByNames(book, [other])).toBeUndefined()
  })
  it('takes none when two series share about as many (one world, two series)', () => {
    const a = { name: 'א', books: [['קאל', 'ארון', 'טמרה', "ג'ספר"].map((w): [string, number] => [w, 5])] }
    const b = { name: 'ב', books: [['קאל', 'ארון', 'טמרה', 'רופוס'].map((w): [string, number] => [w, 5])] }
    expect(seriesByNames(book, [a, b])).toBeUndefined()
  })
})

describe('seriesLists', () => {
  it('reads a list of the series\' books, numbered by place or as it says', () => {
    expect(seriesLists(['ספרים נוספים בסדרה:', 'מבחן הברזל', 'יד הנחושת', 'מפתח הארד', 'מסכת הכסף', 'כל הזכויות שמורות'])).toEqual([
      { series: '', books: [
        { title: 'מבחן הברזל', number: '1' }, { title: 'יד הנחושת', number: '2' },
        { title: 'מפתח הארד', number: '3' }, { title: 'מסכת הכסף', number: '4' },
      ] },
    ])
    expect(seriesLists(['סדרת כס הזכוכית:', '1. כס הזכוכית', '2. כתר חצות', '4. מלכת האור (בקרוב)'])[0]).toEqual({
      series: 'כס הזכוכית',
      books: [{ title: 'כס הזכוכית', number: '1' }, { title: 'כתר חצות', number: '2' }, { title: 'מלכת האור', number: '4' }],
    })
    expect(seriesLists(['בסדרה:', 'ספר ראשון: הפירמידה האדומה', 'ספר שני: כס האש'])[0]!.books[1]).toEqual({ title: 'כס האש', number: '2' })
  })
  it('takes no half-title for a list', () => {
    expect(seriesLists(['סדרת מגיסטריום', 'ספר חמישי', 'מגדל הזהב', 'הולי בלק וקסנדרה קלייר'])).toEqual([])
  })
})

describe('inLists', () => {
  const lists = [
    { series: '', books: [{ title: 'מבחן הברזל', number: '1' }, { title: 'יד הנחושת', number: '2' }, { title: 'מפתח הארד', number: '3' }] },
    { series: 'מגיסטריום', books: [{ title: 'יד הנחושת', number: '2' }, { title: 'מגדל הזהב', number: '5' }] },
  ]
  it('finds the title\'s number, and the series when a list names it', () => {
    expect(inLists('יד הנחושת', lists, norm)).toMatchObject({ series: 'מגיסטריום', number: '2' })
    expect(inLists('מפתח הארד', lists, norm)).toMatchObject({ series: '', number: '3', others: ['מבחן הברזל', 'יד הנחושת'] })
    expect(inLists('ספר אחר', lists, norm)).toBeUndefined()
  })
  it('takes none when lists disagree on the number', () => {
    expect(inLists('יד הנחושת', [...lists, { series: '', books: [{ title: 'יד הנחושת', number: '4' }, { title: 'x', number: '5' }] }], norm)).toBeUndefined()
  })
})
