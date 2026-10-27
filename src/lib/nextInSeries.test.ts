import { describe, expect, it } from 'vitest'
import { nextInSeries, placeNumber } from './nextInSeries'
import type { BookMeta } from './db'

const book = (id: string, title: string, extra: Partial<BookMeta> = {}): BookMeta => ({
  id,
  title,
  author: '',
  kind: 'epub',
  fileName: `${id}.epub`,
  addedAt: 0,
  ...extra,
})

describe('placeNumber', () => {
  it('reads digits, the first word of a long number and Roman numerals', () => {
    expect(placeNumber('3')).toBe(3)
    expect(placeNumber('2 העידן הראשון')).toBe(2)
    expect(placeNumber('IV')).toBe(4)
    expect(placeNumber('ראשון')).toBeUndefined()
  })
})

describe('nextInSeries', () => {
  const library = [
    book('a', "פרסי ג'קסון 1 - גנב הברק"),
    book('b', "פרסי ג'קסון 2 - ים המפלצות"),
    book('c', "פרסי ג׳קסון 4 - הקרב על המבוך"),
    book('d', 'הערפילאים 2 - באר ההתעלות'),
    book('e', 'ספר בודד'),
  ]

  it('finds the next number in the same series', () => {
    const p = nextInSeries(library[0]!, library)
    expect(p).toMatchObject({ series: "פרסי ג'קסון", number: 1, nextNumber: 2 })
    expect(p?.next?.id).toBe('b')
  })

  it('skips a missing number and ignores punctuation differences in the series name', () => {
    const p = nextInSeries(library[1]!, library)
    expect(p?.next?.id).toBe('c')
    expect(p?.nextNumber).toBe(4)
  })

  it('reports the place even when nothing comes after it', () => {
    const p = nextInSeries(library[2]!, library)
    expect(p).toMatchObject({ number: 4 })
    expect(p?.next).toBeUndefined()
  })

  it('is undefined for a book outside a series', () => {
    expect(nextInSeries(library[4]!, library)).toBeUndefined()
  })

  it('prefers the copy opened most recently', () => {
    const copies = [...library, book('b2', "פרסי ג'קסון 2 - ים המפלצות", { lastOpened: 5 })]
    expect(nextInSeries(library[0]!, copies)?.next?.id).toBe('b2')
  })
})
