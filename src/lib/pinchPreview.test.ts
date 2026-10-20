import { describe, expect, it } from 'vitest'
import { wordBounds } from './pinchPreview'

describe('wordBounds', () => {
  const text = 'שלום עולם, hello world'
  it('finds the word around the caret', () => {
    expect(wordBounds(text, 2)).toEqual({ start: 0, end: 4 })
    expect(wordBounds(text, 7)).toEqual({ start: 5, end: 9 })
  })
  it('treats a caret right after a word as that word', () => {
    expect(wordBounds(text, 4)).toEqual({ start: 0, end: 4 })
  })
  it('returns null on a gap between words', () => {
    expect(wordBounds('a  b', 2)).toBeNull()
    expect(wordBounds('', 0)).toBeNull()
  })
})
