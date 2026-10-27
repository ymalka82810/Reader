import { describe, expect, it } from 'vitest'
import { daysAway, lastPassage } from './recap'

describe('lastPassage', () => {
  it('keeps a short text whole, with its spaces tidied', () => {
    expect(lastPassage('  שורה  אחת\n\nושורה שנייה ', 100)).toBe('שורה אחת ושורה שנייה')
  })

  it('starts at a sentence when one starts early enough', () => {
    const text = 'א'.repeat(200) + '. ' + 'המשפט האחרון שנקרא לפני העצירה.'
    expect(lastPassage(text, 60)).toBe('המשפט האחרון שנקרא לפני העצירה.')
  })

  it('otherwise starts at a word, with an ellipsis', () => {
    const text = Array.from({ length: 50 }, (_, i) => `מילה${i}`).join(' ')
    const out = lastPassage(text, 40)
    expect(out.startsWith('…מילה')).toBe(true)
    expect(out.endsWith('מילה49')).toBe(true)
  })
})

describe('daysAway', () => {
  it('counts whole days', () => {
    const day = 24 * 60 * 60 * 1000
    expect(daysAway(0, 3.5 * day)).toBe(3)
  })
})
