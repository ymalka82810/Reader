import { describe, expect, it } from 'vitest'
import { wrapLines } from './quoteImage'

const measure = (s: string) => s.length

describe('wrapLines', () => {
  it('breaks at word boundaries within the width', () => {
    expect(wrapLines('aaa bbb ccc ddd', 7, measure)).toEqual(['aaa bbb', 'ccc ddd'])
  })

  it('splits a word wider than the line', () => {
    expect(wrapLines('abcdefghij', 4, measure)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('starts a new line at a paragraph break', () => {
    expect(wrapLines('aa\nbb', 20, measure)).toEqual(['aa', 'bb'])
  })
})
