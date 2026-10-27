import { describe, expect, it } from 'vitest'
import { addRange, cleanRanges, coveredBefore, readThrough, unionRanges } from './readCover'

describe('read stretches', () => {
  it('merges touching and overlapping stretches', () => {
    let r = addRange([], 0, 0.1)
    r = addRange(r, 0.3, 0.4)
    r = addRange(r, 0.1005, 0.2) // a hair after the first one closes the gap
    r = addRange(r, 0.35, 0.5)
    expect(r).toEqual([
      [0, 0.2],
      [0.3, 0.5],
    ])
    expect(coveredBefore(r)).toBeCloseTo(0.4)
    expect(coveredBefore(r, 0.4)).toBeCloseTo(0.3)
  })

  it('a book is read only when its end was reached and most of it was read', () => {
    expect(readThrough(1, [[0, 0.95]])).toBe(true)
    expect(readThrough(1, [[0, 0.1]])).toBe(false) // dragged to the end
    expect(readThrough(0.95, [[0, 0.95]])).toBe(false) // not at the end yet
    expect(readThrough(0.99, undefined)).toBe(true) // from before the stretches were kept
  })

  it('unites two sets and drops malformed stretches', () => {
    expect(unionRanges([[0, 0.2]], [[0.15, 0.5]])).toEqual([[0, 0.5]])
    expect(unionRanges(undefined, [[0, 0.1]])).toEqual([[0, 0.1]])
    expect(cleanRanges([[0.2, 0.1], 'x', [0, Number.NaN], [0.5]])).toEqual([[0.1, 0.2]])
    expect(cleanRanges('nope')).toBeUndefined()
  })
})
