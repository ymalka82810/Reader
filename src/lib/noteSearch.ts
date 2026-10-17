import type { Annotation, BookMeta } from './db'

export interface NoteHit {
  book: BookMeta
  note: Annotation
  /** pieces of the highlighted text / the written note; `hit` marks the part that matched */
  text: Snippet
  comment?: Snippet
}

export type Snippet = { s: string; hit: boolean }[]

/** a library-wide search stops listing here; the rest would only bury the best matches */
export const MAX_NOTE_HITS = 100
const RADIUS = 60

/** lower-cased and without nikud/accents, with `from[i]` = where folded char `i` starts in the original string */
function fold(s: string) {
  let text = ''
  const from: number[] = []
  let i = 0
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('he')
    for (let k = 0; k < f.length; k++) from.push(i)
    text += f
    i += ch.length
  }
  from.push(s.length)
  return { text, from }
}

const squash = (s: string) => s.replace(/\s+/g, ' ')

/** the part of `text` around the first match of `q` (already folded), cut into plain and matching pieces; undefined when there is none */
function snippet(text: string, q: string): Snippet | undefined {
  const flat = squash(text)
  const { text: folded, from } = fold(flat)
  const at = folded.indexOf(q)
  if (at < 0) return undefined
  const start = from[at]!
  const end = from[at + q.length] ?? flat.length
  const lo = Math.max(0, start - RADIUS)
  const hi = Math.min(flat.length, end + RADIUS)
  const out: Snippet = []
  if (lo > 0) out.push({ s: '…', hit: false })
  if (start > lo) out.push({ s: flat.slice(lo, start), hit: false })
  out.push({ s: flat.slice(start, end), hit: true })
  if (end < hi) out.push({ s: flat.slice(end, hi), hit: false })
  if (hi < flat.length) out.push({ s: '…', hit: false })
  return out
}

/** the beginning of a text, shown when the match is in the other field */
const lead = (text: string): Snippet => {
  const flat = squash(text)
  return [{ s: flat.length > RADIUS * 2 ? flat.slice(0, RADIUS * 2) + '…' : flat, hit: false }]
}

/**
 * Highlights and notes (the highlighted text and the note written on it) of every book that contain `query`,
 * ignoring case and nikud. Bookmarks are only labels, so they are left out. Newest first, at most MAX_NOTE_HITS.
 */
export function searchNotes(books: BookMeta[], notes: Map<string, Annotation[]>, query: string): NoteHit[] {
  const q = fold(squash(query.trim())).text
  if (!q) return []
  const hits: NoteHit[] = []
  for (const book of books) {
    for (const note of notes.get(book.id) ?? []) {
      if (note.kind !== 'highlight') continue
      const text = snippet(note.text, q)
      const comment = note.note ? snippet(note.note, q) : undefined
      if (!text && !comment) continue
      hits.push({ book, note, text: text ?? lead(note.text), comment: comment ?? (note.note ? lead(note.note) : undefined) })
    }
  }
  return hits.sort((a, b) => b.note.createdAt - a.note.createdAt).slice(0, MAX_NOTE_HITS)
}
