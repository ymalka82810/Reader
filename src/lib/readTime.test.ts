import { describe, expect, it } from 'vitest'
import { timeLeft } from './readTime'

describe('timeLeft', () => {
  it('turns foliate time units into minutes at the reader pace', () => {
    // 10 units = 16 KB; at 15 s/KB that is 240 s = 4 min
    expect(timeLeft({ section: 10, total: 100 }, 15, 5)).toEqual({ chapter: 4, book: 40 })
  })

  it('never shows less than a minute while something is left, and nothing when the book is done', () => {
    expect(timeLeft({ section: 0.01, total: 0 }, 15, 5)).toEqual({ chapter: 1, book: null })
  })

  it('leaves the chapter out for a book that is one section', () => {
    expect(timeLeft({ section: 10, total: 10 }, 15, 1).chapter).toBeNull()
  })
})
