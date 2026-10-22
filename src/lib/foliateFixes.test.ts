import { describe, expect, it, vi } from 'vitest'
import type { FoliateView } from 'foliate-js/view.js'
import { alignDocDir, fixBookDir, guardBookEdges } from './foliateFixes'

function fakeView(o: { dir?: string; index?: number; sections?: number; scrolled?: boolean; start?: number; end?: number; viewSize?: number }) {
  const prev = vi.fn(() => Promise.resolve('prev'))
  const next = vi.fn(() => Promise.resolve('next'))
  const view = {
    book: { dir: o.dir, sections: Array.from({ length: o.sections ?? 3 }, () => ({})) },
    renderer: {
      scrolled: o.scrolled ?? true,
      start: o.start ?? 0,
      end: o.end ?? 800,
      viewSize: o.viewSize ?? 5000,
      getContents: () => [{ index: o.index ?? 0 }],
      prev,
      next,
    },
  } as unknown as FoliateView
  return { view, prev, next }
}

describe('alignDocDir', () => {
  const docOf = (dir: string, bodyDirection = '') =>
    ({
      documentElement: { dir },
      body: { dir: '' },
      defaultView: { getComputedStyle: () => ({ direction: bodyDirection }) },
    }) as unknown as Document

  it('makes the book RTL when the chapter is RTL', () => {
    const { view } = fakeView({ dir: 'ltr' })
    alignDocDir(view, docOf('rtl'))
    expect(view.book.dir).toBe('rtl')
  })

  it('makes the chapter RTL when the book is RTL', () => {
    const { view } = fakeView({ dir: 'rtl' })
    const doc = docOf('', 'ltr')
    alignDocDir(view, doc)
    expect(doc.documentElement.dir).toBe('rtl')
  })

  it('never changes the direction of a fixed-layout page (a PDF shown as is)', () => {
    const { view } = fakeView({ dir: 'rtl' })
    ;(view.book as { rendition?: object }).rendition = { layout: 'pre-paginated' }
    const doc = docOf('', 'ltr')
    alignDocDir(view, doc)
    expect(doc.documentElement.dir).toBe('')
  })

  it('leaves left-to-right books alone', () => {
    const { view } = fakeView({})
    const doc = docOf('', 'ltr')
    alignDocDir(view, doc)
    expect(view.book.dir).toBeUndefined()
    expect(doc.documentElement.dir).toBe('')
  })
})

describe('fixBookDir', () => {
  it('marks Hebrew and Arabic books without a page direction as right-to-left', () => {
    for (const lang of ['he', 'ar']) {
      const { view } = fakeView({})
      fixBookDir(view, lang, 'Title')
      expect(view.book.dir).toBe('rtl')
    }
  })

  it('falls back to the title script when the language is unknown', () => {
    const { view } = fakeView({})
    fixBookDir(view, '', 'ספר בדיקה')
    expect(view.book.dir).toBe('rtl')
  })

  it('pairs the pages of a fixed-layout Hebrew book again once it becomes right-to-left', () => {
    const { view } = fakeView({})
    const open = vi.fn()
    ;(view.book as { rendition?: object }).rendition = { layout: 'pre-paginated' }
    ;(view.renderer as { open?: unknown }).open = open
    fixBookDir(view, 'he', 'ספר')
    expect(view.book.dir).toBe('rtl')
    expect(open).toHaveBeenCalledWith(view.book)
  })

  it('keeps an explicit direction and leaves other languages alone', () => {
    const a = fakeView({ dir: 'ltr' })
    fixBookDir(a.view, 'he', 'ספר')
    expect(a.view.book.dir).toBe('ltr')
    const b = fakeView({})
    fixBookDir(b.view, 'en', 'Book')
    expect(b.view.book.dir).toBeUndefined()
  })
})

describe('guardBookEdges', () => {
  it('ignores prev() at the top of the first section in scrolled mode', async () => {
    const { view, prev } = fakeView({ index: 0, start: 0 })
    guardBookEdges(view)
    await view.renderer.prev()
    expect(prev).not.toHaveBeenCalled()
  })

  it('ignores next() at the bottom of the last section in scrolled mode', async () => {
    const { view, next } = fakeView({ index: 2, start: 4200, end: 5000, viewSize: 5000 })
    guardBookEdges(view)
    await view.renderer.next()
    expect(next).not.toHaveBeenCalled()
  })

  it('passes turns through everywhere else', async () => {
    const mid = fakeView({ index: 0, start: 300 })
    guardBookEdges(mid.view)
    await mid.view.renderer.prev()
    await mid.view.renderer.next()
    expect(mid.prev).toHaveBeenCalled()
    expect(mid.next).toHaveBeenCalled()

    const later = fakeView({ index: 1, start: 0 })
    guardBookEdges(later.view)
    await later.view.renderer.prev()
    expect(later.prev).toHaveBeenCalled()

    const paged = fakeView({ index: 0, start: 0, scrolled: false })
    guardBookEdges(paged.view)
    await paged.view.renderer.prev()
    expect(paged.prev).toHaveBeenCalled()
  })
})
