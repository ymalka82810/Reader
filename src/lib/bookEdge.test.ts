import { describe, expect, it } from 'vitest'
import type { FoliateView } from 'foliate-js/view.js'
import { atBookEdge, turnDirection } from './bookEdge'

const view = (renderer: object, dir = 'rtl') => ({ book: { dir }, renderer }) as unknown as FoliateView

describe('turnDirection', () => {
  it('goes forward on the left edge of an RTL book and back on the right', () => {
    expect(turnDirection(view({}), 'left')).toBe(1)
    expect(turnDirection(view({}), 'right')).toBe(-1)
  })
  it('is the other way round in an LTR book', () => {
    expect(turnDirection(view({}, 'ltr'), 'left')).toBe(-1)
    expect(turnDirection(view({}, 'ltr'), 'right')).toBe(1)
  })
})

describe('atBookEdge', () => {
  it('uses the paginator flags', () => {
    const v = view({ scrolled: false, atStart: true, atEnd: false })
    expect(atBookEdge(v, -1, 0)).toBe(true)
    expect(atBookEdge(v, 1, 0)).toBe(false)
    expect(atBookEdge(view({ scrolled: false, atStart: false, atEnd: true }), 1, 1)).toBe(true)
  })
  it('falls back to the book position without flags (fixed layout)', () => {
    const v = view({ scrolled: false })
    expect(atBookEdge(v, -1, 0)).toBe(true)
    expect(atBookEdge(v, -1, 0.4)).toBe(false)
    expect(atBookEdge(v, 1, 1)).toBe(true)
  })
  it('checks the section edge too in scrolled mode', () => {
    const v = view({ scrolled: true, start: 0, end: 800, viewSize: 5000 })
    expect(atBookEdge(v, -1, 0)).toBe(true)
    expect(atBookEdge(v, 1, 0)).toBe(false)
    expect(atBookEdge(view({ scrolled: true, start: 4200, end: 5000, viewSize: 5000 }), 1, 1)).toBe(true)
  })
  it('is false with no view', () => {
    expect(atBookEdge(null, 1, 1)).toBe(false)
  })
})
