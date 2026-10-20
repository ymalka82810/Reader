import { describe, expect, it } from 'vitest'
import { bookType, byLength, inResume, isFiltering, isStale, longestOf, NO_FILTER, typesOf } from './libraryFilter'

const b = (fileName: string, extra = {}) => ({ kind: 'epub' as const, fileName, ...extra })

describe('library filter', () => {
  it('tells file types apart', () => {
    expect(bookType(b('A.EPUB'))).toBe('epub')
    expect(bookType(b('a.epub', { fromPdf: true }))).toBe('pdf')
    expect(bookType(b('a.m4b', { kind: 'audio' as const }))).toBe('audio')
    expect(bookType(b('a.mobi'))).toBe('mobi')
    expect(bookType(b('noext'))).toBe('other')
  })

  it('lists types most common first', () => {
    expect(typesOf([b('a.mobi'), b('b.epub'), b('c.epub')])).toEqual(['epub', 'mobi'])
  })

  it('knows when nothing is filtered', () => {
    expect(isFiltering(NO_FILTER)).toBe(false)
    expect(isFiltering({ ...NO_FILTER, folder: '' })).toBe(true)
    expect(isFiltering({ ...NO_FILTER, ids: new Set(['x']) })).toBe(true)
  })

  it('flags unfinished books untouched for a month as stale', () => {
    const day = 86_400_000
    const now = 100 * day
    expect(isStale({ addedAt: now - 40 * day }, now)).toBe(true)
    expect(isStale({ addedAt: now - 40 * day, lastOpened: now - 5 * day }, now)).toBe(false)
    expect(isStale({ addedAt: now - 90 * day, lastOpened: now - 31 * day, fraction: 0.4 }, now)).toBe(true)
    expect(isStale({ addedAt: now - 90 * day, lastOpened: now - 31 * day, finished: true }, now)).toBe(false)
    expect(isStale({ addedAt: now - 5 * day }, now)).toBe(false)
  })

  it('orders by length and picks the longest', () => {
    const book = (id: string, kind: 'epub' | 'audio' = 'epub', duration = 0) => ({ id, kind, audio: kind === 'audio' ? { duration, chapters: [] } : undefined })
    const sizes = new Map([['a', 10], ['b', 30], ['c', 20]])
    const list = [book('a'), book('x', 'audio', 5), book('b'), book('y', 'audio', 50), book('c')]
    expect([...list].sort(byLength(sizes)).map((x) => x.id)).toEqual(['b', 'c', 'a', 'y', 'x'])
    expect([...longestOf(list, sizes)].sort()).toEqual(['a', 'b', 'c'])
  })

  it('counts a smart collection as filtering', () => {
    expect(isFiltering({ ...NO_FILTER, smart: 'stale' })).toBe(true)
  })
})

describe('inResume', () => {
  const DAY = 86_400_000
  const now = 100 * DAY

  it('keeps a started, unfinished book', () => {
    expect(inResume({ fraction: 0.4, lastOpened: now - 10 * DAY }, now)).toBe(true)
  })
  it('drops a book at 3% or less once untouched for more than 3 days', () => {
    expect(inResume({ fraction: 0.03, lastOpened: now - 3 * DAY - 1 }, now)).toBe(false)
    expect(inResume({ fraction: 0.01, lastOpened: now - 5 * DAY }, now)).toBe(false)
  })
  it('keeps a barely-started book for up to 3 days, and a book over 3% however old', () => {
    expect(inResume({ fraction: 0.03, lastOpened: now - 3 * DAY }, now)).toBe(true)
    expect(inResume({ fraction: 0.031, lastOpened: now - 30 * DAY }, now)).toBe(true)
  })
  it('drops finished and never-started books', () => {
    expect(inResume({ fraction: 0.99, lastOpened: now }, now)).toBe(false)
    expect(inResume({ fraction: 0.5, finished: true, lastOpened: now }, now)).toBe(false)
    expect(inResume({ fraction: 0, lastOpened: now }, now)).toBe(false)
  })
  it('hides a book removed by hand until it is opened again', () => {
    expect(inResume({ fraction: 0.4, lastOpened: now - DAY, resumeHiddenAt: now }, now)).toBe(false)
    expect(inResume({ fraction: 0.4, lastOpened: now + 1, resumeHiddenAt: now }, now)).toBe(true)
  })
})
