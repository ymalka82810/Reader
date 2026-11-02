import { describe, expect, it } from 'vitest'
import { imageCoverage, isPictorialPage, looksLikeComic, type ImageOps } from './pdfImages'

const ops: ImageOps = { save: 10, restore: 11, transform: 12, formBegin: 74, formEnd: 75, images: new Set([85]) }
const PAGE = 400 * 600

describe('imageCoverage', () => {
  it('counts a full-page picture', () => {
    expect(imageCoverage([10, 12, 85, 11], [null, [400, 0, 0, 600, 0, 0], ['img'], null], ops, PAGE)).toBeCloseTo(1)
  })

  it('adds up panels placed side by side and forgets a transform after restore', () => {
    const fn = [10, 12, 85, 11, 10, 12, 85, 11]
    const args = [null, [200, 0, 0, 600, 0, 0], ['a'], null, null, [200, 0, 0, 600, 200, 0], ['b'], null]
    expect(imageCoverage(fn, args, ops, PAGE)).toBeCloseTo(1)
  })

  it('follows a picture drawn inside a form', () => {
    const fn = [10, 74, 12, 85, 75, 11]
    const args = [null, [[2, 0, 0, 2, 0, 0]], [200, 0, 0, 300, 0, 0], ['a'], null, null]
    expect(imageCoverage(fn, args, ops, PAGE)).toBeCloseTo(1)
  })

  it('is zero for a page with no pictures or no size', () => {
    expect(imageCoverage([12], [[1, 0, 0, 1, 0, 0]], ops, PAGE)).toBe(0)
    expect(imageCoverage([85], [['a']], ops, 0)).toBe(0)
  })
})

describe('telling a comic from a scanned book', () => {
  it('a full-page picture with a few words is pictorial', () => {
    expect(isPictorialPage(0.95, 40)).toBe(true)
  })

  it('a full-page scan with a recognised page of text is not', () => {
    expect(isPictorialPage(0.95, 1800)).toBe(false)
  })

  it('a text page with a small logo is not', () => {
    expect(isPictorialPage(0.05, 40)).toBe(false)
  })

  it('a comic is a book where at least half the pages are pictorial', () => {
    expect(looksLikeComic([true, true, false, false])).toBe(true)
    expect(looksLikeComic([true, false, false])).toBe(false)
    expect(looksLikeComic([])).toBe(false)
  })
})
