import { describe, expect, it } from 'vitest'
import { buildCards, dueCards, nextState, vocabKey, type Card, type CardState, type VocabWord } from './flashcards'
import type { Annotation, BookMeta } from './db'

const DAY = 24 * 60 * 60 * 1000
const card = (id: string): Card => ({ id, kind: 'word', front: id, back: 'b', source: '' })

describe('nextState', () => {
  it('moves a new card to the first box, due in a day', () => {
    expect(nextState(undefined, true, 1000)).toEqual({ box: 0, due: 1000 + DAY })
  })
  it('waits longer after each correct answer and stops growing at the last interval', () => {
    let s: CardState | undefined
    const gaps: number[] = []
    for (let i = 0; i < 9; i++) {
      s = nextState(s, true, 0)
      gaps.push(s.due / DAY)
    }
    expect(gaps).toEqual([1, 3, 7, 16, 35, 90, 90, 90, 90])
  })
  it('sends a forgotten card back to the start, due immediately', () => {
    expect(nextState({ box: 4, due: 5 }, false, 1000)).toEqual({ box: 0, due: 1000 })
  })
})

describe('dueCards', () => {
  const now = 10 * DAY
  const cards = ['new1', 'late', 'later', 'future', 'new2'].map(card)
  const states = new Map<string, CardState>([
    ['late', { box: 1, due: now - 3 * DAY }],
    ['later', { box: 1, due: now - DAY }],
    ['future', { box: 2, due: now + DAY }],
  ])
  it('puts the most overdue first, then new cards, and skips cards not yet due', () => {
    expect(dueCards(cards, states, now).map((c) => c.id)).toEqual(['late', 'later', 'new1', 'new2'])
  })
  it('respects the limit', () => {
    expect(dueCards(cards, states, now, 2).map((c) => c.id)).toEqual(['late', 'later'])
  })
})

describe('buildCards', () => {
  const book = (id: string, title: string) => ({ id, title }) as BookMeta
  const hl = (id: string, text: string, note?: string): Annotation => ({ id, kind: 'highlight', cfi: 'c', text, color: '', note, createdAt: 0 })
  const word: VocabWord = { key: vocabKey('en', 'Serene'), word: 'Serene', lang: 'en', definition: 'calm', bookId: 'b1', addedAt: 0 }

  it('makes a card per word and per highlight, naming the book', () => {
    const notes = new Map<string, Annotation[]>([['b1', [hl('n1', 'a passage'), hl('n2', 'quote', 'my note')]]])
    const cards = buildCards([word], notes, [book('b1', 'Book One')])
    expect(cards).toEqual([
      { id: 'w:en:serene', kind: 'word', front: 'Serene', back: 'calm', source: 'Book One', lang: 'en' },
      { id: 'h:b1:n1', kind: 'highlight', front: 'a passage', back: '', source: 'Book One' },
      { id: 'h:b1:n2', kind: 'highlight', front: 'my note', back: 'quote', source: 'Book One' },
    ])
  })
  it('ignores bookmarks, empty highlights and notes of books no longer in the library', () => {
    const notes = new Map<string, Annotation[]>([
      ['b1', [{ ...hl('m', 'label'), kind: 'bookmark' }, hl('e', '  ')]],
      ['gone', [hl('x', 'orphan')]],
    ])
    expect(buildCards([], notes, [book('b1', 'B')])).toEqual([])
  })
})
