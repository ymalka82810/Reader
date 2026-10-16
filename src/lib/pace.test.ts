import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SECS_PER_KB, linearSizes, loadPace, paceFromStats, savePace, screenSecs } from './pace'

describe('paceFromStats', () => {
  it('needs enough reading data', () => {
    expect(paceFromStats({ secs: 60, frac: 0.1 }, 100_000)).toBeNull()
    expect(paceFromStats({ secs: 600, frac: 0.001 }, 100_000)).toBeNull()
    expect(paceFromStats({ secs: 600, frac: 0.1 }, 0)).toBeNull()
  })

  it('converts time per fraction of the book into seconds per KB', () => {
    // 10% of a 500 KB book (50 KB) in 10 minutes → 12 s/KB
    expect(paceFromStats({ secs: 600, frac: 0.1 }, 500_000)).toBeCloseTo(12)
  })
})

describe('screenSecs', () => {
  it('spreads the section reading time over its screens', () => {
    // 20 KB section at 15 s/KB = 300 s, over 10 screens
    expect(screenSecs(15, 20_000, 10)).toBeCloseTo(30)
  })

  it('stays within sane bounds', () => {
    expect(screenSecs(15, 500, 10)).toBe(3)
    expect(screenSecs(300, 1_000_000, 1)).toBe(600)
  })

  it('gives sections without text a short fixed time', () => {
    expect(screenSecs(15, 0, 3)).toBe(5)
    expect(screenSecs(15, 1000, 0)).toBe(5)
  })
})

describe('linearSizes', () => {
  it('ignores non-linear and empty sections', () => {
    expect(linearSizes([{ size: 10 }, { size: 20, linear: 'no' }, {}, { size: 5, linear: 'yes' }])).toEqual([10, 0, 0, 5])
  })
})

describe('stored pace', () => {
  beforeEach(() => localStorage.clear())

  it('defaults when nothing was saved, and round-trips', () => {
    expect(loadPace()).toBe(DEFAULT_SECS_PER_KB)
    savePace(14)
    expect(loadPace()).toBe(14)
  })
})
