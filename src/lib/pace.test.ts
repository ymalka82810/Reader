import { beforeEach, describe, expect, it } from 'vitest'
import {
  BOOK_TRUST_SECS,
  DEFAULT_SECS_PER_KB,
  DEFAULT_SECS_PER_WORD,
  estimatePace,
  HALF_LIFE_WORDS,
  learnPace,
  linearSizes,
  loadAutoFactor,
  loadProfile,
  personalSecsPerWord,
  saveAutoFactor,
  screenSecs,
} from './pace'

beforeEach(() => localStorage.clear())

const none = { secs: 0, frac: 0 }

describe('personal pace', () => {
  it('is unknown until enough was read', () => {
    learnPace(60, 200)
    expect(personalSecsPerWord()).toBeNull()
    learnPace(600, 2000)
    expect(personalSecsPerWord()).toBeCloseTo(660 / 2200)
  })

  it('lets older reading fade, so a change in pace shows up', () => {
    learnPace(HALF_LIFE_WORDS * 0.5, HALF_LIFE_WORDS) // 0.5 s per word
    learnPace(HALF_LIFE_WORDS * 0.25, HALF_LIFE_WORDS) // then 0.25 s per word
    // the old half counts half: (0.5·½ + 0.25) / (½ + 1) ≈ 0.333
    expect(personalSecsPerWord()).toBeCloseTo(1 / 3)
  })

  it('keeps time read without moving on (words come with a later page turn)', () => {
    learnPace(300, 0)
    learnPace(0, 1000)
    const p = loadProfile()
    expect(p.secs).toBeCloseTo(300 * 0.5 ** (1000 / HALF_LIFE_WORDS))
    expect(p.words).toBe(1000)
  })
})

describe('estimatePace', () => {
  // a book of 100,000 words in 1 MB: 10 bytes a word
  const book = { totalBytes: 1_000_000, words: 100_000 }

  it('starts a new book from a typical pace, in its own bytes per word', () => {
    expect(estimatePace({ stats: none, ...book })).toBeCloseTo(DEFAULT_SECS_PER_WORD * 100)
  })

  it('starts a new book from the personal pace learned in other books', () => {
    learnPace(3000, 10_000) // 0.3 s per word
    expect(estimatePace({ stats: none, ...book })).toBeCloseTo(30)
  })

  it('gives the same words-per-minute in a book with twice the bytes per word (Hebrew, heavy markup)', () => {
    learnPace(3000, 10_000)
    expect(estimatePace({ stats: none, totalBytes: 2_000_000, words: 100_000 })).toBeCloseTo(15)
  })

  it("moves to the book's own pace as reading time in it adds up", () => {
    learnPace(3000, 10_000) // prior 30 s/KB
    // the book read at 10 s/KB: 1% (10 KB) in 100 s, then 6% in 600 s, then 60% in 6000 s
    const at = (secs: number) => estimatePace({ stats: { secs, frac: secs / 10_000 }, ...book })
    expect(at(100)).toBeGreaterThan(20)
    expect(at(BOOK_TRUST_SECS)).toBeCloseTo(Math.sqrt(30 * 10)) // half way on a log scale
    expect(at(6000)).toBeLessThan(12)
  })

  it('falls back to the default per KB when the word count is unknown', () => {
    expect(estimatePace({ stats: none, totalBytes: 1_000_000, words: null })).toBe(DEFAULT_SECS_PER_KB)
  })

  it('a noisy first minute cannot swing the estimate far', () => {
    const p = estimatePace({ stats: { secs: 30, frac: 0.000_01 }, ...book })
    expect(p).toBeLessThan(DEFAULT_SECS_PER_WORD * 100 * 1.5)
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

describe('auto-reading factor', () => {
  it('defaults to the estimate itself, and round-trips', () => {
    expect(loadAutoFactor()).toBe(1)
    saveAutoFactor(0.8)
    expect(loadAutoFactor()).toBe(0.8)
  })
})
