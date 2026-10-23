import { describe, expect, it } from 'vitest'
import { isKeptPdf, linesToParagraphs } from './pdfOcr'

describe('linesToParagraphs', () => {
  it('joins lines of a paragraph and splits after a short sentence-ending line', () => {
    const lines = ['This is a long line of the first paragraph that', 'goes on and ends here.', 'A new one starts and', 'ends too.']
    expect(linesToParagraphs(lines)).toEqual([
      'This is a long line of the first paragraph that goes on and ends here.',
      'A new one starts and ends too.',
    ])
  })
  it('joins a hyphenated word', () => {
    expect(linesToParagraphs(['a very long line with a split wo-', 'rd inside it.'])).toEqual(['a very long line with a split word inside it.'])
  })
  it('keeps a trailing unfinished paragraph', () => {
    expect(linesToParagraphs(['no ending'])).toEqual(['no ending'])
  })
})

describe('isKeptPdf', () => {
  it('is a PDF kept as it is, not a converted one', () => {
    expect(isKeptPdf({ fromPdf: true, fileName: 'a.pdf' })).toBe(true)
    expect(isKeptPdf({ fromPdf: true, fileName: 'a.epub' })).toBe(false)
    expect(isKeptPdf({ fileName: 'a.pdf' })).toBe(false)
  })
})
