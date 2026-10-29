// The word tagger's training and its check (see wordModel). The training lines are generated from the bundled series list
// (public/series-he.json): every book of it is printed the ways a title page prints one (the template "series 3 - title",
// "title מאת author", "author: title", "title (series #3)", a copyright line, a credit line, a praise line), and each word
// knows the tag it was generated with. The check is on books it never saw: the series are split, and the held-out ones
// are tagged by a model trained on the rest, with a gazetteer that holds only the names of the trained ones, so that it
// is a book the library and the bundled list do not know. The starting weights the app ships (wordModel/weights.json) are
// trained on all the series: `npm run train:words`.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { people } from './bookName'
import { norm } from './sameBook'
import type { BenchCase } from './identifyBench'
import { confident, DIM, known, partsOf, step, tagByName, tagWords, tokenize, WORD_TAGS, wordFacts, type Gazetteer, type Table, type WordTag } from './wordModel'

const dir = fileURLToPath(new URL('./', import.meta.url))
const series = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/series-he.json', import.meta.url)), 'utf8')) as {
  s: string
  a?: string
  b: [string, string, number?][]
}[]
const cases = JSON.parse(readFileSync(`${dir}identifyBench/cases.json`, 'utf8')) as BenchCase[]

/** below this share of words tagged right on books it did not learn from, the tagger has got worse */
const FLOOR = 0.85
const EPOCHS = 16
const LINES = 3
const RATE = 0.12
const T = WORD_TAGS.length

// ---- the generated lines

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Part = [string, WordTag]
interface Book {
  series: string
  author: string
  number: string
  title: string
  year?: number
}

const ORDINALS = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי']
const PUBLISHERS = ['כתר', 'מודן', 'זמורה ביתן', 'ידיעות ספרים', 'אסטרולוג', 'הקיבוץ המאוחד', 'אופוס', 'עם עובד', 'כנרת']
const PRAISE = ['יצירת מופת אמיתית', 'רב המכר הבינלאומי', 'הספר שכולם מדברים עליו', 'זוכה פרס', 'מותחן שלא ניתן להניח מהיד']
const GENRES = ['רומן', 'נובלה', 'סיפורים', 'מותחן']
const STREETS = ['אגוז', 'הרצל', 'ויצמן', 'התעשייה', 'הבנים', 'דרך השלום']
const CITIES = ['קרית גת', 'מודיעין', 'תל אביב', 'פתח תקווה', 'חיפה', 'ראשון לציון']

// a book whose title holds its series' name (\"אווטאר: כשף האוויר האחרון – ההבטחה\") cannot be told apart by the words alone
const books: Book[] = series
  .flatMap((e) => e.b.map(([number, title, year]) => ({ series: e.s, author: e.a ?? '', number, title, ...(year && { year }) })))
  .filter((b) => !` ${norm(b.title)} `.includes(` ${norm(b.series)} `))
const authors = [...new Set(series.flatMap((e) => (e.a ? [e.a] : [])))]

/** a line of a title page: the parts with their tags, in one of the ways a title page prints a book */
function lineOf(b: Book, rand: () => number, all: Book[]): Part[] {
  const pick = <X>(xs: readonly X[]): X => xs[Math.floor(rand() * xs.length)]!
  const n = Number(b.number)
  const word = n >= 1 && n <= 10 ? (rand() < 0.5 ? ORDINALS[n]! : String(n)) : String(n)
  const bookWord: Part[] = rand() < 0.5 ? [[pick(['ספר', 'כרך']), 'number'], [word, 'number']] : [[String(n), 'number']]
  const dash = pick(['-', '–', ':', '/', '|', ','])
  const other = pick(all)
  const T_: Part = [b.title, 'title']
  const S_: Part = [b.series, 'series']
  const A_: Part = [b.author || other.author || pick(authors), 'author']
  const sep = (): Part[] => (rand() < 0.5 ? [[dash, 'noise']] : [])
  const year = b.year ?? 1990 + Math.floor(rand() * 33)
  const templates: (() => Part[])[] = [
    () => [T_],
    () => [T_],
    () => [S_, ...bookWord, ...sep(), T_],
    () => [S_, [String(n), 'number'], ...sep(), T_],
    () => [S_, [String(n), 'number'], T_, ['מאת', 'noise'], A_],
    () => [T_, ['מאת', 'noise'], A_],
    () => [T_, ['by', 'noise'], A_],
    () => [A_, [dash, 'noise'], T_],
    () => [T_, [dash, 'noise'], A_],
    () => [T_, [pick(['/', '|', '•']), 'noise'], A_],
    () => [T_, ['(', 'noise'], S_, ['#', 'noise'], [String(n), 'number'], [')', 'noise']],
    () => [T_, ['(', 'noise'], S_, [',', 'noise'], ...bookWord, [')', 'noise']],
    () => [...bookWord, ['בסדרת', 'noise'], S_],
    () => [...bookWord, ['בסדרה', 'noise'], S_],
    () => [S_, ...bookWord],
    () => [S_],
    () => [A_],
    () => [['מאת', 'noise'], A_],
    () => [T_, [String(year), 'year']],
    () => [['©', 'noise'], [String(year), 'year'], A_],
    () => [A_, [String(year), 'year']],
    () => [['הוצאת', 'noise'], [pick(PUBLISHERS), 'noise'], [String(year), 'year']],
    () => [['תרגום', 'noise'], [':', 'noise'], [other.author || pick(authors), 'noise']],
    () => [['עריכה', 'noise'], [':', 'noise'], [pick(authors), 'noise']],
    () => [['מאנגלית', 'noise'], [pick(authors), 'noise']],
    () => [[pick(PRAISE), 'noise']],
    () => [[pick(GENRES), 'noise']],
    () => [['"', 'noise'], T_, ['"', 'noise']],
    () => [['כל הזכויות שמורות', 'noise'], ['©', 'noise'], [String(year), 'noise']],
    () => [[`רח' ${pick(STREETS)} ${1 + Math.floor(rand() * 90)}, ${pick(CITIES)} ${7000000 + Math.floor(rand() * 999999)}`, 'noise']],
    () => [[`ת.ד. ${1 + Math.floor(rand() * 900)}, ${pick(CITIES)}`, 'noise']],
    () => [[`טל' 0${3 + Math.floor(rand() * 5)}-${1000000 + Math.floor(rand() * 8999999)}`, 'noise']],
    () => [[`"${pick(PRAISE)}!"`, 'noise'], ['-', 'noise'], [pick(['עכשיו', 'הארץ', 'ידיעות אחרונות', 'ניו יורק טיימס']), 'noise']],
    () => [[`${pick(all).title.split(' ').slice(0, 3).join(' ')} ${pick(all).title.split(' ').slice(-2).join(' ')} ${pick(all).title.split(' ')[0]!}.`, 'noise']],
    () => [['www.', 'noise'], ['example', 'noise'], ['.co.il', 'noise']],
  ]
  return pick(templates)()
}

interface Example {
  line: string
  tags: WordTag[]
}

/** a generated line as its words and the tag of each: every character of a part has its tag, a word the tag of its first */
function example(parts: Part[]): Example {
  let line = ''
  const chars: WordTag[] = []
  for (const [text, tag] of parts) {
    if (line) {
      line += ' '
      chars.push('noise')
    }
    line += text
    for (let i = 0; i < text.length; i++) chars.push(tag)
  }
  return { line, tags: tokenize(line).map((t) => chars[t.start]!) }
}

const names = (bs: Book[]): Gazetteer => ({
  authors: new Set(bs.flatMap((b) => (b.author && people(b.author).split(' ').length >= 2 ? [people(b.author)] : []))),
  series: new Set(bs.flatMap((b) => (norm(b.series).split(' ').length >= 2 ? [norm(b.series)] : []))),
  titles: new Set(bs.flatMap((b) => (norm(b.title).split(' ').length >= 2 ? [norm(b.title)] : []))),
})
const nothing = (): Gazetteer => ({ authors: new Set(), series: new Set(), titles: new Set() })

// ---- the training

function train(bs: Book[], seed: number): Table {
  const rand = rng(seed)
  const w = new Float32Array(DIM * T)
  const order = bs.map((_, i) => i)
  for (let e = 0; e < EPOCHS; e++) {
    // a fresh shuffle, and a fresh line for each book, each epoch
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[order[i], order[j]] = [order[j]!, order[i]!]
    }
    for (const bi of order) {
      const b = bs[bi]!
      for (let r = 0; r < LINES; r++) {
        const ex = example(lineOf(b, rand, bs))
        // half the lines are met with the book's names known (a book of the library), half without (a new one)
        const g = rand() < 0.5 ? names([b, ...bs.filter(() => rand() < 0.1)]) : nothing()
        const tokens = tokenize(ex.line)
        const k = known(tokens, g)
        const gold = ex.tags.map((t) => WORD_TAGS.indexOf(t))
        const li = Math.floor(rand() * 3)
        tokens.forEach((_, i) => step(w, wordFacts(tokens, i, gold, k, li), gold[i]!, RATE / (1 + e / 4), 0.001))
      }
    }
  }
  return w
}

// ---- the check

const rand = rng(7)
let held: Table | undefined
const heldOut = () => (held ??= train(trainBooks, 1))
const heldSeries = new Set(series.filter((_, i) => i % 5 === 2).map((e) => e.s))
const trainBooks = books.filter((b) => !heldSeries.has(b.series))
const heldBooks = books.filter((b) => heldSeries.has(b.series))

function wordsRight(w: Table, bs: Book[], g: Gazetteer, per = 6) {
  let right = 0
  let all = 0
  let linesRight = 0
  let lines = 0
  const wrong: string[] = []
  for (const b of bs) {
    for (let r = 0; r < per; r++) {
      const ex = example(lineOf(b, rand, bs))
      const got = tagWords(ex.line, {}, 0, g, {}, w)
      let ok = true
      got.forEach((x, i) => {
        all++
        if (x.tag === ex.tags[i]) right++
        else ok = false
      })
      lines++
      if (ok) linesRight++
      else if (wrong.length < 12) wrong.push(`${ex.line}  →  ${got.map((x) => `${x.token.text}/${x.tag}`).join(' ')}`)
    }
  }
  return { words: right / all, lines: linesRight / lines, wrong }
}

it(`tags the words of books it did not learn from (${heldBooks.length} held-out books, ${trainBooks.length} trained)`, () => {
  const w = heldOut()
  const gaz = names(trainBooks)
  const unknown = wordsRight(w, heldBooks, gaz)
  const knownBooks = wordsRight(w, heldBooks, names([...trainBooks, ...heldBooks]))
  if (process.env.WORDS_TRAIN === '1' || process.env.BENCH_REPORT === '1') {
    console.log(`words right on new books: ${Math.round(unknown.words * 1000) / 10}% (whole lines ${Math.round(unknown.lines * 1000) / 10}%)`)
    console.log(`words right on books the list knows: ${Math.round(knownBooks.words * 1000) / 10}% (whole lines ${Math.round(knownBooks.lines * 1000) / 10}%)`)
    for (const x of unknown.wrong) console.log(`✗ ${x}`)
  }
  expect(unknown.words).toBeGreaterThanOrEqual(FLOOR)
  // knowing the book's names helps, never hurts
  expect(knownBooks.words).toBeGreaterThanOrEqual(unknown.words - 0.01)
}, 120_000)

it('splits no real title-page line that holds one part, and splits the lines that hold several (the benchmark)', () => {
  const w = heldOut()
  let falseSplits = 0
  let single = 0
  let several = 0
  let split = 0
  const wrong: string[] = []
  for (const c of cases) {
    for (const [li, line] of (c.input.opening ?? []).slice(0, 15).entries()) {
      const gold = c.expect.title && c.expect.author !== undefined ? tagByName(line, c.expect, c.expect.author || c.input.author) : undefined
      if (!gold) continue
      const kinds = new Set(gold.filter((t) => t === 'title' || t === 'author' || t === 'series' || t === 'number'))
      const got = partsOf(line, tagWords(line, {}, li, nothing(), {}, w))
      const sure = confident(tagWords(line, {}, li, nothing(), {}, w))
      const gotKinds = new Set(got.map((p) => p.tag).filter((t) => t === 'title' || t === 'author' || t === 'series' || t === 'number'))
      if (kinds.size <= 1) {
        single++
        if (sure && gotKinds.size >= 2) {
          falseSplits++
          wrong.push(`${c.id}: ${line}`)
        }
      } else {
        several++
        if (sure && gotKinds.size >= 2) split++
      }
    }
  }
  if (process.env.WORDS_TRAIN === '1' || process.env.BENCH_REPORT === '1') {
    console.log(`real lines with one part: ${single}, wrongly split: ${falseSplits}; with several parts: ${several}, split: ${split}`)
    for (const x of wrong) console.log(`✗ ${x}`)
  }
  expect(single).toBeGreaterThan(0)
  expect(falseSplits).toBe(0)
}, 120_000)

it('keeps the parts of a line together, and drops the cue of a credit', () => {
  const w = heldOut()
  const line = 'הארי פוטר 3 והאסיר מאזקבאן מאת ג\'יי קיי רולינג'
  const parts = partsOf(line, tagWords(line, {}, 0, nothing(), {}, w))
  expect(parts.map((p) => p.tag)).toContain('author')
  const credit = partsOf('תרגום: דני כהן', tagWords('תרגום: דני כהן', {}, 0, nothing(), {}, w))
  expect(credit.some((p) => p.tag === 'author')).toBe(false)
}, 120_000)

it.runIf(process.env.WORDS_TRAIN === '1')('writes the starting weights, trained on every series', () => {
  const w = train(books, 3)
  const table: Record<string, number[]> = {}
  for (let b = 0; b < DIM; b++) {
    const row = Array.from({ length: T }, (_, t) => Math.round(w[b * T + t]! * 100) / 100)
    if (Math.max(...row.map(Math.abs)) >= 0.03) table[String(b)] = row
  }
  writeFileSync(`${dir}wordModel/weights.json`, `${JSON.stringify({ dim: DIM, w: table })}\n`)
}, 120_000)
