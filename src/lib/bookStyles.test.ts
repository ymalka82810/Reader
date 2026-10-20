// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { markOwnStyles, setBookStyles } from './foliateFixes'

/** a section the way foliate builds it: its own <style> first and last in the head, the book's between them */
function section() {
  // the page's own document, because jsdom only builds style sheets for a document with a window
  const doc = document
  doc.head.replaceChildren()
  const book = doc.createElement('link')
  book.rel = 'stylesheet'
  book.href = 'blob:http://localhost/x'
  const inline = doc.createElement('style')
  inline.textContent = 'p { text-indent: 2em }'
  const before = doc.createElement('style')
  const after = doc.createElement('style')
  doc.head.append(book, inline)
  doc.head.prepend(before)
  doc.head.append(after)
  return { doc, book, inline, before, after }
}

describe('book styles', () => {
  afterEach(() => document.head.replaceChildren())

  it('marks the two styles foliate adds, and only them', () => {
    const { doc, book, inline, before, after } = section()
    markOwnStyles(doc)
    expect(before.hasAttribute('data-reader-style')).toBe(true)
    expect(after.hasAttribute('data-reader-style')).toBe(true)
    expect(inline.hasAttribute('data-reader-style')).toBe(false)
    expect(book.hasAttribute('data-reader-style')).toBe(false)
  })

  it('switches off the book\'s linked and embedded styles but not the app\'s', () => {
    const { doc, book, inline, before, after } = section()
    markOwnStyles(doc)
    setBookStyles(doc, false)
    expect(book.disabled).toBe(true)
    expect(inline.disabled).toBe(true)
    expect(before.disabled).toBe(false)
    expect(after.disabled).toBe(false)
  })

  it('switches them back on', () => {
    const { doc, book, inline } = section()
    markOwnStyles(doc)
    setBookStyles(doc, false)
    setBookStyles(doc, true)
    expect(book.disabled).toBe(false)
    expect(inline.disabled).toBe(false)
  })

  it('does nothing for a document without a head to mark', () => {
    const doc = { head: null } as unknown as Document
    expect(() => markOwnStyles(doc)).not.toThrow()
  })
})
