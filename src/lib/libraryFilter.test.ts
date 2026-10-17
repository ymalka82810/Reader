import { describe, expect, it } from 'vitest'
import { bookType, isFiltering, NO_FILTER, typesOf } from './libraryFilter'

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
})
