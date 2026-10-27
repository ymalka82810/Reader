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
  loadPaceData,
  mergePaceData,
  monthlyWpm,
  bookSpeeds,
  wpmByLanguage,
  paceLang,
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
    const p = loadPaceData().all
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

describe('per language', () => {
  const book = { stats: none, totalBytes: 1_000_000, words: 100_000 }

  it('uses the pace of the book language once enough was read in it, else the overall one', () => {
    learnPace(3000, 10_000, 'he') // 0.3 s per word in Hebrew
    learnPace(1500, 10_000, 'en-US') // 0.15 s per word in English
    expect(personalSecsPerWord('he')).toBeCloseTo(0.3)
    expect(personalSecsPerWord('en')).toBeCloseTo(0.15)
    expect(personalSecsPerWord('fr')).toBeCloseTo(4500 / 20_000)
    expect(estimatePace({ ...book, lang: 'he' })).toBeCloseTo(30)
    expect(estimatePace({ ...book, lang: 'en' })).toBeCloseTo(15)
  })

  it('reads language codes the way books write them', () => {
    expect(paceLang('he-IL')).toBe('he')
    expect(paceLang('iw')).toBe('he')
    expect(paceLang('EN_gb')).toBe('en')
    expect(paceLang('')).toBe('?')
  })

  it('lists words a minute per language, the most read first, leaving out unknown languages', () => {
    learnPace(600, 2000, 'en') // 200 wpm
    learnPace(1200, 3000, 'he') // 150 wpm
    learnPace(600, 3000, null)
    expect(wpmByLanguage(loadPaceData())).toEqual([
      { lang: 'he', wpm: 150 },
      { lang: 'en', wpm: 200 },
    ])
  })
})

describe('speed history', () => {
  it('keeps words a minute per month, and leaves thin months empty', () => {
    const now = new Date(2026, 9, 20).getTime()
    learnPace(600, 2400, 'he', new Date(2026, 8, 5).getTime()) // September: 240 wpm
    learnPace(60, 200, 'he', now) // October: too little
    const months = monthlyWpm(loadPaceData(), now, 3)
    expect(months).toEqual([
      { key: '2026-08', wpm: null },
      { key: '2026-09', wpm: 240 },
      { key: '2026-10', wpm: null },
    ])
  })

  it('reads the first stored version (only an overall profile)', () => {
    localStorage.setItem('reader:readingPace', JSON.stringify({ secs: 900, words: 3000 }))
    expect(loadPaceData()).toEqual({ all: { secs: 900, words: 3000 }, langs: {}, months: {} })
  })

  it('a restored backup keeps whichever side read more', () => {
    learnPace(600, 2000, 'he', new Date(2026, 9, 1).getTime())
    mergePaceData({ all: { secs: 6000, words: 20_000 }, langs: { en: { secs: 600, words: 3000 } }, months: { '2026-09': { en: { secs: 600, words: 3000 } } } })
    const d = loadPaceData()
    expect(d.all.words).toBe(20_000)
    expect(d.langs.he!.words).toBe(2000)
    expect(d.langs.en!.words).toBe(3000)
    expect(Object.keys(d.months).sort()).toEqual(['2026-09', '2026-10'])
  })
})

describe('bookSpeeds', () => {
  it('compares books read long enough with the usual speed, the furthest from it first', () => {
    const books = [
      { id: 'fast', title: 'Fast', words: 100_000 },
      { id: 'slow', title: 'Slow', words: 100_000 },
      { id: 'short', title: 'Barely opened', words: 100_000 },
      { id: 'uncounted', title: 'No count' },
    ]
    const stats = new Map([
      ['fast', { secs: 1200, frac: 0.1 }], // 10,000 words in 20 min: 500 wpm
      ['slow', { secs: 3000, frac: 0.05 }], // 5,000 words in 50 min: 100 wpm
      ['short', { secs: 60, frac: 0.01 }],
      ['uncounted', { secs: 3000, frac: 0.5 }],
    ])
    const r = bookSpeeds(books, stats, 250)
    expect(r.map((b) => [b.id, b.wpm])).toEqual([
      ['slow', 100],
      ['fast', 500],
    ])
    expect(r[1]!.ratio).toBeCloseTo(2)
  })
})
