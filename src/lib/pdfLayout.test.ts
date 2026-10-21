import { describe, expect, it } from 'vitest'
import { buildLines, type RawItem } from './pdfLayout'

const item = (str: string, x: number, w: number, y = 700, h = 14): RawItem => ({ str, x, y, w, h, eol: false })

describe('buildLines: spaces between runs', () => {
  it('puts a space between word runs that have a visible gap and no space character', () => {
    // left to right: "hello" then "world", 5 apart
    expect(buildLines([item('hello', 100, 30), item('world', 135, 30)])[0]!.text).toBe('hello world')
  })
  it('does the same when the runs go right to left', () => {
    expect(buildLines([item('שלום', 200, 30), item('עולם', 165, 30)])[0]!.text).toBe('שלום עולם')
  })
  it('does not add a space between runs that touch (kerning)', () => {
    expect(buildLines([item('Wor', 100, 20), item('ld', 120.5, 10)])[0]!.text).toBe('World')
  })
  it('does not double a space the runs already carry', () => {
    expect(buildLines([item('hello ', 100, 33), item('world', 140, 30)])[0]!.text).toBe('hello world')
    expect(buildLines([item('hello', 100, 30), item(' world', 140, 33)])[0]!.text).toBe('hello world')
  })
  it('leaves letter-spaced single characters alone', () => {
    expect(buildLines([item('T', 100, 8), item('I', 112, 4), item('T', 120, 8)])[0]!.text).toBe('TIT')
  })
  it('does not join runs from different lines', () => {
    expect(buildLines([item('one', 100, 20, 700), item('two', 100, 20, 650)]).map((l) => l.text)).toEqual(['one', 'two'])
  })
})
