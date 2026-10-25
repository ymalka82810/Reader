import { describe, expect, it } from 'vitest'
import { baseCandidates } from './morphology'

const guesses = (lang: string, word: string) => baseCandidates(lang, word).map((c) => c.word)

describe('baseCandidates', () => {
  it('takes Hebrew prefixes off', () => {
    expect(guesses('he', 'וכשהלכתי')).toContain('הלכתי')
    expect(guesses('he', 'הספרים')).toContain('ספרים')
    expect(guesses('he', 'ובבית')).toContain('בית')
  })

  it('takes Hebrew endings off and gives back a final letter', () => {
    expect(guesses('he', 'הלכתי')).toContain('הלך')
    expect(guesses('he', 'מלכים')).toContain('מלך')
    expect(guesses('he', 'מלכתו')).toContain('מלכה')
    expect(guesses('he', 'ראיתי')).toContain('ראה')
  })

  it('undoes the marks of Hebrew verb tenses and patterns, and full spelling', () => {
    expect(guesses('he', 'יכתבו')).toContain('כתב')
    expect(guesses('he', 'מתלבשים')).toContain('התלבש')
    expect(guesses('he', 'אלך')).toContain('הלך')
    expect(guesses('he', 'לכתוב')).toContain('כתב')
    expect(guesses('he', 'חיפשתי')).toContain('חפש')
    expect(guesses('he', 'ייכתב')).toContain('נכתב')
  })

  it('tries fewer changes first and ignores niqqud', () => {
    const list = baseCandidates('he', 'הַסְּפָרִים')
    expect(list.find((c) => c.word === 'ספרים')?.cost).toBe(1)
    expect(list.map((c) => c.cost)).toEqual([...list.map((c) => c.cost)].sort((a, b) => a - b))
    expect(list.some((c) => c.word === 'הספרים')).toBe(false)
  })

  it('handles Arabic clitics, endings and hamza', () => {
    expect(guesses('ar', 'وبكتابها')).toContain('كتاب')
    expect(guesses('ar', 'مدرستها')).toContain('مدرسة')
    expect(guesses('ar', 'يكتبون')).toContain('كتب')
    expect(guesses('ar', 'اكبر')).toContain('أكبر')
  })

  it('leaves other languages and mixed scripts to the pack', () => {
    expect(guesses('en', 'dogs')).toEqual([])
    expect(guesses('he', 'abc')).toEqual([])
  })
})
