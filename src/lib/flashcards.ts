import { createStore, del, entries, get, set } from 'idb-keyval'
import type { Annotation, BookMeta } from './db'

/** a word looked up in the dictionary, saved so it can be reviewed later */
export interface VocabWord {
  /** `${lang}:${lower-cased word}`: looking the same word up again updates this entry instead of adding one */
  key: string
  word: string
  lang: string
  /** start of the dictionary entry, shown on the back of the card */
  definition: string
  bookId: string
  addedAt: number
}

/** how well a card is known: `box` climbs on every correct answer, `due` is when it is asked next */
export interface CardState {
  box: number
  due: number
}

export type Card = {
  /** `w:<vocab key>` or `h:<book id>:<note id>`, also the key of its CardState */
  id: string
  kind: 'word' | 'highlight'
  front: string
  back: string
  /** the book the word or highlight came from */
  source: string
  /** language of the front, for fonts and hyphenation */
  lang?: string
}

const vocabStore = createStore('reader-vocab-db', 'words')
const reviewStore = createStore('reader-review-db', 'cards')

const DAY = 24 * 60 * 60 * 1000
/** days to wait after a correct answer from box 0, 1, 2…; the last one repeats */
const INTERVALS = [1, 3, 7, 16, 35, 90]
/** the cards of one sitting; the rest wait for the next */
const SESSION_SIZE = 20
/** the dictionary text kept per word; the popup shows more, a card only needs the gist */
const MAX_DEFINITION = 600

export const vocabKey = (lang: string, word: string) => `${lang}:${word.toLocaleLowerCase(lang)}`

/** Records a looked-up word. Looking it up again keeps the original date and card progress. */
export async function saveWord(word: string, lang: string, definition: string, bookId: string): Promise<void> {
  const key = vocabKey(lang, word)
  const old = await get<VocabWord>(key, vocabStore)
  const text = definition.length > MAX_DEFINITION ? definition.slice(0, MAX_DEFINITION).trimEnd() + '…' : definition
  await set(key, { key, word, lang, definition: text, bookId, addedAt: old?.addedAt ?? Date.now() } satisfies VocabWord, vocabStore)
}

export const listWords = async () => (await entries<string, VocabWord>(vocabStore)).map(([, w]) => w)

export async function removeWord(key: string): Promise<void> {
  await del(key, vocabStore)
  await del(`w:${key}`, reviewStore)
}

export const loadCardStates = async () => new Map(await entries<string, CardState>(reviewStore))

/** `true` = remembered: the card moves up a box and waits longer; `false` = forgotten: back to box 0, asked again soon */
export function nextState(prev: CardState | undefined, known: boolean, now: number): CardState {
  if (!known) return { box: 0, due: now }
  const box = (prev?.box ?? -1) + 1
  return { box, due: now + INTERVALS[Math.min(box, INTERVALS.length - 1)]! * DAY }
}

/** Folds a backup's words and card progress into this device's: what is here stays, so restoring an old backup
 *  never undoes a review; for a card known on both sides the one further along wins. */
export async function mergeReview(words: VocabWord[], states: Record<string, CardState>): Promise<void> {
  for (const w of words) {
    if (typeof w?.key === 'string' && typeof w.word === 'string' && !(await get(w.key, vocabStore))) await set(w.key, w, vocabStore)
  }
  for (const [id, s] of Object.entries(states)) {
    if (!Number.isFinite(s?.box) || !Number.isFinite(s?.due)) continue
    const cur = await get<CardState>(id, reviewStore)
    if (!cur || s.box > cur.box) await set(id, s, reviewStore)
  }
}

export const saveCardState =(id: string, state: CardState) => set(id, state, reviewStore)

/** Every word and highlight as a card. A highlight with a note shows the note as the prompt, a bare one shows the passage. */
export function buildCards(words: VocabWord[], notes: Map<string, Annotation[]>, books: BookMeta[]): Card[] {
  const title = new Map(books.map((b) => [b.id, b.title]))
  const cards: Card[] = words
    .filter((w) => w.definition)
    .map((w) => ({
      id: `w:${w.key}`,
      kind: 'word',
      front: w.word,
      back: w.definition,
      source: title.get(w.bookId) ?? '',
      lang: w.lang,
    }))
  for (const [bookId, list] of notes) {
    if (!title.has(bookId)) continue
    for (const n of list) {
      if (n.kind !== 'highlight' || !n.text.trim()) continue
      cards.push({
        id: `h:${bookId}:${n.id}`,
        kind: 'highlight',
        front: n.note?.trim() || n.text,
        back: n.note?.trim() ? n.text : '',
        source: title.get(bookId)!,
      })
    }
  }
  return cards
}

/** The cards to ask now: overdue ones first (most overdue first), then new ones, up to `limit`. */
export function dueCards(cards: Card[], states: Map<string, CardState>, now: number, limit = SESSION_SIZE): Card[] {
  const due: [Card, number][] = []
  const fresh: Card[] = []
  for (const c of cards) {
    const s = states.get(c.id)
    if (!s) fresh.push(c)
    else if (s.due <= now) due.push([c, s.due])
  }
  due.sort((a, b) => a[1] - b[1])
  return [...due.map(([c]) => c), ...fresh].slice(0, limit)
}
