import { describe, expect, it } from 'vitest'
import { bookNumber, librarySeriesFor, originalSeries, soundOf } from './bookInference'
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
    expect(originalSeries(golden)).toEqual({ series: 'MAGISTERIUM', number: '5' })
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
