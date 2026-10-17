import { describe, expect, it } from 'vitest'
import type { Annotation, BookMeta } from './db'
import { MAX_NOTE_HITS, searchNotes } from './noteSearch'

const book = (id: string): BookMeta => ({ id, title: id, author: '', kind: 'epub', fileName: id, addedAt: 0 })
const hl = (id: string, text: string, createdAt: number, note?: string): Annotation => ({
  id,
  kind: 'highlight',
  cfi: id,
  text,
  color: '#ff0',
  note,
  createdAt,
})

describe('searchNotes', () => {
  const books = [book('a'), book('b')]

  it('finds text and written notes in every book, newest first', () => {
    const notes = new Map([
      ['a', [hl('1', 'The quick brown fox', 1)]],
      ['b', [hl('2', 'unrelated', 3, 'my FOX note'), hl('3', 'fox again', 2)]],
    ])
    const hits = searchNotes(books, notes, 'fox')
    expect(hits.map((h) => h.note.id)).toEqual(['2', '3', '1'])
    expect(hits[0]!.comment!.find((p) => p.hit)!.s).toBe('FOX')
    // the match is in the note, so the highlighted text is shown from its start
    expect(hits[0]!.text.some((p) => p.hit)).toBe(false)
  })

  it('ignores case and nikud and keeps the original spelling in the match', () => {
    const notes = new Map([['a', [hl('1', 'בְּרֵאשִׁית בָּרָא', 1)]]])
    const [hit] = searchNotes(books, notes, 'בראשית')
    expect(hit!.text.find((p) => p.hit)!.s).toBe('בְּרֵאשִׁית')
  })

  it('skips bookmarks, books that are gone and blank queries', () => {
    const mark: Annotation = { ...hl('m', 'fox', 1), kind: 'bookmark' }
    const notes = new Map([['a', [mark]], ['gone', [hl('g', 'fox', 1)]]])
    expect(searchNotes(books, notes, 'fox')).toEqual([])
    expect(searchNotes(books, new Map([['a', [hl('1', 'fox', 1)]]]), '  ')).toEqual([])
  })

  it('cuts long text around the match and caps the list', () => {
    const long = `${'x'.repeat(200)} needle ${'y'.repeat(200)}`
    const [hit] = searchNotes(books, new Map([['a', [hl('1', long, 1)]]]), 'needle')
    expect(hit!.text.map((p) => p.s).join('').length).toBeLessThan(200)
    expect(hit!.text[0]!.s).toBe('…')
    const many = Array.from({ length: MAX_NOTE_HITS + 20 }, (_, i) => hl(String(i), 'fox', i))
    expect(searchNotes(books, new Map([['a', many]]), 'fox')).toHaveLength(MAX_NOTE_HITS)
  })
})
