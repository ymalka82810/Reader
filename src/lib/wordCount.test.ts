// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { countWords, wordsOfBook, wordsOfExtracted } from './wordCount'

describe('word count', () => {
  it('counts Hebrew, Latin and numbers', () => {
    expect(countWords('שלום עולם, hello-world 42!')).toBe(5)
    expect(countWords('  ')).toBe(0)
  })

  it('adds up the linear sections that have a document', async () => {
    const doc = (text: string) => () => new DOMParser().parseFromString(`<p>${text}</p>`, 'text/html')
    const n = await wordsOfBook({
      sections: [
        { createDocument: doc('one two three') },
        { linear: 'no', createDocument: doc('skipped skipped') },
        {},
        { createDocument: async () => doc('four five')() },
      ],
    })
    expect(n).toBe(5)
  })
})

describe('wordsOfExtracted', () => {
  it('counts the words of every paragraph of every chapter', () => {
    expect(
      wordsOfExtracted({ chapters: [{ paras: ['שלום עולם', 'one two three'] }, { paras: [] }, { paras: ['ארבע, חמש.'] }] }),
    ).toBe(7)
  })
  it('is zero for no chapters', () => {
    expect(wordsOfExtracted({ chapters: [] })).toBe(0)
  })
})
