import { describe, expect, it } from 'vitest'
import { norm, sameBook } from './sameBook'

const b = (title: string, author = '') => ({ title, author })

describe('norm', () => {
  it('ignores nikud, case, punctuation and quote styles', () => {
    expect(norm('שָׁלוֹם')).toBe('שלום')
    expect(norm('Café: The  Book!')).toBe('cafe the book')
    expect(norm('ספר: הכותרת')).toBe(norm('ספר - הכותרת'))
    expect(norm('“Quoted”')).toBe(norm('"quoted"'))
  })
  it('is empty for titles made only of symbols', () => {
    expect(norm('---')).toBe('')
    expect(norm('')).toBe('')
  })
})

describe('sameBook', () => {
  it('matches the same title and author', () => {
    expect(sameBook(b('מלחמה ושלום', 'טולסטוי'), b('מלחמה ושלום!', 'טולסטוי'))).toBe(true)
  })
  it('rejects the same title by different authors', () => {
    expect(sameBook(b('מלחמה ושלום', 'טולסטוי'), b('מלחמה ושלום', 'אחר'))).toBe(false)
  })
  it('matches when one author is missing and the title is distinctive', () => {
    expect(sameBook(b('מלחמה ושלום', 'טולסטוי'), b('מלחמה ושלום'))).toBe(true)
  })
  it('does not match generic short titles when an author is missing', () => {
    expect(sameBook(b('מבוא', 'א'), b('מבוא'))).toBe(false)
    expect(sameBook(b('מבוא'), b('מבוא'))).toBe(false)
  })
  it('never matches titles with no letters or digits', () => {
    expect(sameBook(b('---', 'x'), b('...', 'x'))).toBe(false)
    expect(sameBook(b('', ''), b('', ''))).toBe(false)
  })
})
