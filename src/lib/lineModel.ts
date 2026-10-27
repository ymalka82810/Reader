// The identification's line classifier: each line of a book's title page, half-title, copyright page and cover (after
// OCR) is given one of five tags (the title, the author, the series, the book's number, or noise), from simple facts
// about the line: where it stands, how long it is, the words that mark it ("מאת", "תרגום", "ספר ראשון", "בסדרת"),
// digits, the shape of a person's name, whether the library has it as an author or a series, and the lines around it.
// A small softmax regression over those facts, a few kilobytes, that runs at once on any phone. It starts from the
// weights learnt from the identification's benchmark (lineModel/weights.json, `npm run train:lines`) and keeps learning
// on the device: a name the user approves or saves tags the lines of that book's opening, and each tagged line is one
// training step. The cover and the pages are read side by side and checked against each other (crossRead): a cover
// sets the title large on one book and the author on another, and the title page tells which is which.
// It only reads what the hand-written rules (nameFromOpening, authorFromOpening) left unread: a title page with no
// series and no number, under a file name that says nothing.

import { BESTSELLER, bookLine, CREDIT, IN_SERIES, isJunkTitle, NOT_A_NAME, people, personShaped, pieces, seriesOf, type BookName } from './bookName'
import LINE_WEIGHTS from './lineModel/weights.json'
import { norm } from './sameBook'

export const TAGS = ['title', 'author', 'series', 'number', 'noise'] as const
export type Tag = (typeof TAGS)[number]

export const FEATURES = [
  'bias',
  'first',
  'second',
  'third',
  'late',
  'short',
  'medium',
  'long',
  'veryLong',
  'oneWord',
  'twoWords',
  'fewWords',
  'manyWords',
  'hebrew',
  'latin',
  'digit',
  'person',
  'initial',
  'functionWord',
  'definite',
  'plural',
  'upper',
  'genre',
  'imprint',
  'praise',
  'repeated',
  'inOther',
  'authorElsewhere',
  'credit',
  'notName',
  'inSeries',
  'bookLine',
  'byCue',
  'quote',
  'sentence',
  'copyright',
  'givenTitle',
  'givenAuthor',
  'libAuthor',
  'libSeries',
  'largest',
  'prevBook',
  'nextBook',
  'nextInSeries',
  'prevPerson',
  'nextPerson',
  'partOfNext',
  'holdsPrev',
] as const
type Feature = (typeof FEATURES)[number]

/** what the book and the library already say, besides its lines */
export interface LineContext {
  /** the author the book came with, when it has one */
  author?: string
  /** the title the book came with, when it says something */
  title?: string
  /** the library's authors and series */
  authors?: Iterable<string>
  series?: Iterable<string>
  /** the cover's largest line, as OCR read it */
  largest?: string
  /** the lines of the book's other source (the cover's for the pages, the pages' for the cover) */
  other?: readonly string[]
  /** the cover as OCR read it: its largest line and its lines, read beside the pages and checked against them */
  cover?: { largest?: string; lines: readonly string[] }
}

/** the lines the classifier reads: the first ones, cleaned, a title page the PDF joined into one line split back */
export function lineUnits(lines: readonly string[], author = ''): string[] {
  return lines
    .slice(0, 15)
    .flatMap((l) => pieces(l.replace(/_+/g, ' ').replace(/[\u200E\u200F]/g, '').replace(/\s+/g, ' ').trim(), author))
    .filter((l) => /\p{L}{2}/u.test(l))
    .slice(0, 20)
}

const HEBREW = /[\u05D0-\u05EA]/
const LATIN = /[A-Za-z]/
// words a title has and a person's name hardly ever does: "של", "על", "the", "of"…
const FUNCTION_WORD = /(?:^|\s)(?:של|על|את|עם|בין|כמו|לא|אין|כל|אל|אחרי|לפני|אשר|או|גם|רק|עד|the|of|and|a|an|in|to|for|on|with|at)(?=\s|$)/iu
// a word after the first with the article, alone or after a letter that joins it ("האהבה", "מהאגם", "בקצה השדה")
const DEFINITE = /\s[ובלמכש]?ה[\u05D0-\u05EA]{2,}/u
// what a cover says in praise of the book or its author, not its name
const PRAISE = /רבי?[-־\s]?ה?מכר|ה?מצליח(?:ה|ים)?\s|bestsell|best[-\s]sell|award|פרס\s|זוכ(?:ה|ת)\s/iu
// what a cover says of the kind of book, not its name
const GENRE = /^(?:רומן|נובלה|סיפורים|סיפור|שירים|שירה|מותחן|ממואר|מסה|ספר ילדים|a novel|novel|stories|poems|a memoir|memoir)$/iu
const BY = /^(?:מאת|by)\s*[:：]?\s*/iu

function featuresOf(units: readonly string[], i: number, ctx: LineContext, known: { authors: Set<string>; series: Set<string> }): number[] {
  const l = units[i]!
  const prev = units[i - 1]
  const next = units[i + 1]
  const words = l.split(' ').length
  const n = norm(l)
  const on = new Set<Feature>(['bias'])
  if (i === 0) on.add('first')
  if (i === 1) on.add('second')
  if (i === 2) on.add('third')
  if (i >= 6) on.add('late')
  if (l.length <= 15) on.add('short')
  else if (l.length <= 30) on.add('medium')
  else if (l.length <= 50) on.add('long')
  else on.add('veryLong')
  if (words === 1) on.add('oneWord')
  else if (words === 2) on.add('twoWords')
  else if (words <= 5) on.add('fewWords')
  else on.add('manyWords')
  if (HEBREW.test(l)) on.add('hebrew')
  if (LATIN.test(l)) on.add('latin')
  if (/\d/.test(l)) on.add('digit')
  if (personShaped(l.replace(BY, ''))) on.add('person')
  if (/(?:^|\s)(?:[\p{L}][.׳']|[A-Z]\.)(?=\s|$)/u.test(l)) on.add('initial')
  if (FUNCTION_WORD.test(l)) on.add('functionWord')
  if (DEFINITE.test(l)) on.add('definite')
  if (/[\u05D0-\u05EA]{3,}(?:ים|ות)(?=\s|$)/u.test(l)) on.add('plural')
  if (LATIN.test(l) && words >= 2 && l === l.toUpperCase()) on.add('upper')
  if (GENRE.test(l)) on.add('genre')
  if (PRAISE.test(l)) on.add('praise')
  if (units.some((u, j) => j !== i && norm(u) === n)) on.add('repeated')
  if (n && ctx.other?.some((o) => norm(o) === n)) on.add('inOther')
  if (/^(?:ספרי|ספריית|הספרייה|סדרת ספרי|בית הוצאה|books\b|press\b)\s?/iu.test(l) && words >= 2) on.add('imprint')
  if (CREDIT.test(l)) on.add('credit')
  if (NOT_A_NAME.test(l)) on.add('notName')
  if (IN_SERIES.test(l) || /(?:^|\s)(?:ב|מ)?ה?סדר(?:ה|ת)\s/u.test(l)) on.add('inSeries')
  if (bookLine(l)) on.add('bookLine')
  if (/^(?:מאת|by)\b/iu.test(l)) on.add('byCue')
  if (/["״“”„]/.test(l)) on.add('quote')
  if (/[.!?]["״”']?\s*$/.test(l) && words >= 4) on.add('sentence')
  if (/©|copyright|כל הזכויות|isbn/iu.test(l)) on.add('copyright')
  if (ctx.title && n && norm(ctx.title) === n) on.add('givenTitle')
  if (ctx.author && people(ctx.author) && people(l.replace(BY, '')) === people(ctx.author)) on.add('givenAuthor')
  // the author the book came with is printed on another line: this one is not the author
  else if (ctx.author && people(ctx.author) && units.some((u) => people(u.replace(BY, '')) === people(ctx.author!))) on.add('authorElsewhere')
  if (known.authors.has(people(l.replace(BY, '')))) on.add('libAuthor')
  if (n && known.series.has(n)) on.add('libSeries')
  if (ctx.largest && n && norm(ctx.largest) === n) on.add('largest')
  if (prev && bookLine(prev)) on.add('prevBook')
  if (next && bookLine(next)) on.add('nextBook')
  if (next && IN_SERIES.test(next)) on.add('nextInSeries')
  if (prev && personShaped(prev) && !CREDIT.test(prev)) on.add('prevPerson')
  if (next && personShaped(next) && !CREDIT.test(next)) on.add('nextPerson')
  if (next && n && norm(next) !== n && ` ${norm(next)} `.includes(` ${n} `)) on.add('partOfNext')
  if (prev && n && norm(prev) && norm(prev) !== n && ` ${n} `.includes(` ${norm(prev)} `)) on.add('holdsPrev')
  return FEATURES.map((f) => (on.has(f) ? 1 : 0))
}

// ---- the model

const KEY = 'reader:identify:lines'
const RATE = 0.3
const DECAY = 60
/** pulled back toward the starting weights, so a few answers tune it without undoing what the benchmark taught */
const L2 = 0.01

type Weights = number[][]
type Model = { w: Weights; n: number }

const valid = (w: unknown): w is Weights =>
  Array.isArray(w) && w.length === TAGS.length && w.every((r) => Array.isArray(r) && r.length === FEATURES.length && r.every((x) => Number.isFinite(x)))

/** the starting weights: per tag, per feature, as weights.json keeps them (a feature it does not name weighs nothing) */
export function startWeights(table: Partial<Record<string, Partial<Record<string, number>>>> = LINE_WEIGHTS): Weights {
  return TAGS.map((t) => FEATURES.map((f) => table[t]?.[f] ?? 0))
}

function load(): Model {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Model | null
    if (v && valid(v.w) && Number.isFinite(v.n)) return v
  } catch {
    /* unreadable: start again from the benchmark's weights */
  }
  return { w: startWeights(), n: 0 }
}

function save(m: Model) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* storage unavailable: learnt until the app closes at most */
  }
}

function softmax(w: Weights, x: number[]): number[] {
  const z = w.map((row) => row.reduce((s, wi, i) => s + wi * x[i]!, 0))
  const top = Math.max(...z)
  const e = z.map((v) => Math.exp(v - top))
  const sum = e.reduce((a, b) => a + b, 0)
  return e.map((v) => v / sum)
}

function knownOf(ctx: LineContext) {
  return { authors: new Set([...(ctx.authors ?? [])].map(people).filter(Boolean)), series: new Set([...(ctx.series ?? [])].map(norm).filter(Boolean)) }
}

/** each line with the chance of each tag */
export function classifyLines(lines: readonly string[], ctx: LineContext = {}, w: Weights = load().w): { line: string; p: Record<Tag, number> }[] {
  const units = lineUnits(lines, ctx.author)
  const known = knownOf(ctx)
  return units.map((line, i) => {
    const p = softmax(w, featuresOf(units, i, ctx, known))
    return { line, p: Object.fromEntries(TAGS.map((t, k) => [t, p[k]!])) as Record<Tag, number> }
  })
}

/** the tag each line has, by the name the book is known to have (what the user approved, or a benchmark case's answer);
 *  undefined for a line that cannot be told (a name the answer leaves out) */
export function tagLines(lines: readonly string[], name: Partial<BookName>, author = '', ctx: LineContext = {}): (Tag | undefined)[] {
  const title = norm(name.title ?? '')
  const series = norm(name.series ?? '')
  const a = people(author)
  return lineUnits(lines, ctx.author).map((l) => {
    const n = norm(l.replace(/\s*[|•·]+\s*$/u, ''))
    if (title && n === title) return 'title'
    if (a && people(l.replace(BY, '')) === a) return 'author'
    if (series && n !== title && ` ${n} `.includes(` ${series} `) && !CREDIT.test(l)) return 'series'
    if (bookLine(l)) return 'number'
    // a line that may be a name the answer leaves out says nothing
    if ((!title && n.split(' ').length <= 8) || (!a && personShaped(l))) return undefined
    return 'noise'
  })
}

/** one step of the softmax regression for a tagged line, pulled toward the starting weights */
export function trainStep(w: Weights, x: number[], tag: Tag, rate: number, start: Weights = startWeights()): Weights {
  const p = softmax(w, x)
  const k = TAGS.indexOf(tag)
  return w.map((row, t) => row.map((wi, i) => wi + rate * (((t === k ? 1 : 0) - p[t]!) * x[i]! - L2 * (wi - start[t]![i]!))))
}

/** the features of every line, for training (the benchmark's script, and learnLines) */
export function lineFeatures(lines: readonly string[], ctx: LineContext = {}): number[][] {
  const units = lineUnits(lines, ctx.author)
  const known = knownOf(ctx)
  return units.map((_, i) => featuresOf(units, i, ctx, known))
}

/** the user approved or saved this name for a book whose opening lines are these: each line it tags is a step */
export function learnLines(lines: readonly string[], name: BookName, author: string, ctx: LineContext = {}) {
  if (!lines.length || isJunkTitle(name.title)) return
  // the lines are read as the identification met them: with no title or author of the book's own when it had none
  const xs = lineFeatures(lines, ctx)
  const tags = tagLines(lines, name, author, ctx)
  if (!tags.some((t) => t === 'title' || t === 'author')) return
  const m = load()
  const start = startWeights()
  xs.forEach((x, i) => {
    const tag = tags[i]
    if (!tag) return
    m.w = trainStep(m.w, x, tag, RATE / (1 + m.n / DECAY), start)
    m.n++
  })
  save(m)
}

/** how many lines the classifier has learnt from on this device, for the stats */
export function linesReport(): number {
  return load().n
}

// ---- reading a name out of the tags

/**
 * The lines of the pages and of the cover, each tagged on its own and then checked against each other. A cover sets
 * the title large on one book and the author's name on another, so its largest line says little by itself; but the same
 * text on the title page, where "מאת", the order of the lines and the credits around it say what it is, tells which one
 * it is. A text both have takes the chances of both together (their product, normalized): what the two sources agree on
 * wins, and what one is sure of decides for the other.
 */
function crossRead(lines: readonly string[], ctx: LineContext): { line: string; p: Record<Tag, number> }[] {
  const coverLines = [...new Set([...(ctx.cover?.largest ? [ctx.cover.largest] : []), ...(ctx.cover?.lines ?? [])])]
  const pages = classifyLines(lines, { ...ctx, cover: undefined, ...(coverLines.length && { other: coverLines }) })
  if (!coverLines.length) return pages
  const cover = classifyLines(coverLines, { ...ctx, cover: undefined, largest: ctx.cover?.largest, other: lines })
  const all = new Map<string, { line: string; p: Record<Tag, number> }>()
  for (const x of [...pages, ...cover]) {
    const k = norm(x.line.replace(BY, ''))
    const had = all.get(k)
    if (!had) {
      all.set(k, x)
      continue
    }
    const joint = TAGS.map((t) => had.p[t] * x.p[t])
    const sum = joint.reduce((a, b) => a + b, 0) || 1
    all.set(k, { line: had.line, p: Object.fromEntries(TAGS.map((t, i) => [t, joint[i]! / sum])) as Record<Tag, number> })
  }
  return [...all.values()]
}

/** below this chance a tag is not taken */
const BAR = 0.5

/** The name the lines say, by the tag each line most likely has (the cover's lines, when given, checked against the
 *  pages'): the title, the author, the series and its number, each only when the line passes the rules every name
 *  passes (not a credit, an address, praise or a sentence, a person's shape for an author). `hebrewBook` keeps a Hebrew
 *  book's title Hebrew. */
export function readLines(lines: readonly string[], ctx: LineContext = {}, hebrewBook = false): Partial<BookName> & { author?: string } {
  const tagged = crossRead(lines, ctx)
  const best = (tag: Tag, ok: (l: string) => boolean) =>
    tagged
      .filter((x) => x.p[tag] >= BAR && Math.max(...TAGS.map((t) => x.p[t])) === x.p[tag] && ok(x.line))
      .sort((a, b) => b.p[tag] - a.p[tag])[0]?.line
  const plain = (l: string) => l.length <= 70 && !CREDIT.test(l) && !NOT_A_NAME.test(l) && !PRAISE.test(l) && !bookLine(l)
  const title = best('title', (l) => plain(l) && !isJunkTitle(l) && (!hebrewBook || HEBREW.test(l)))?.replace(/\s*[|•·]+\s*$/u, '')
  const author = best(
    'author',
    (l) =>
      plain(l.replace(BY, '')) &&
      personShaped(l.replace(BY, '')) &&
      !/\d/.test(l) &&
      // a numbered volume ("MAGISTERIUM V") is no person
      !/\s[IVXLivxl]{1,4}$/u.test(l) &&
      !(title && ` ${norm(title)} `.includes(` ${norm(l.replace(BY, ''))} `)),
  )?.replace(BY, '')
  const seriesLine = best('series', (l) => l.length <= 70 && !CREDIT.test(l) && !NOT_A_NAME.test(l) && !(title && norm(l) === norm(title)))
  let series = ''
  let number = ''
  if (seriesLine) {
    const whole = seriesOf(seriesLine)
    const bare = (s: string) =>
      s
        .replace(IN_SERIES, '')
        .replace(BESTSELLER, '')
        .replace(/^[\s"״“”„']+|[\s"״“”„']+$/gu, '')
        .trim()
    if (whole && /\s(?:ב?סדרת|בסדרה|of the|in the)\s/iu.test(seriesLine)) {
      series = bare(whole.series)
      number = whole.number
    } else series = bare(seriesLine)
  }
  if (series && !number) {
    const numberLine = best('number', (l) => !!bookLine(l))
    number = (numberLine && bookLine(numberLine)?.number) || ''
  }
  if (series && title && norm(series) === norm(title)) series = ''
  return {
    ...(title && { title }),
    ...(author && { author }),
    ...(series && { series, number }),
  }
}

// ---- the opening lines of the books waiting for an answer

const OPENINGS_KEY = 'reader:identify:openings'
const OPENINGS_MAX = 300

type Opening = { lines: string[]; author?: string; title?: string }

function openings(): Record<string, Opening> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPENINGS_KEY) ?? 'null')
    return v && typeof v === 'object' ? (v as Record<string, Opening>) : {}
  } catch {
    return {}
  }
}

/** the opening lines a book was identified by (and what it came with), kept until the user answers about its name */
export function keepOpening(id: string, lines: readonly string[], came: { author?: string; title?: string } = {}) {
  const units = lines.slice(0, 15).map((l) => l.slice(0, 120))
  if (!units.length) return
  const all = openings()
  delete all[id]
  all[id] = { lines: units, ...(came.author && { author: came.author }), ...(came.title && !isJunkTitle(came.title) && { title: came.title }) }
  const ids = Object.keys(all)
  for (const old of ids.slice(0, Math.max(0, ids.length - OPENINGS_MAX))) delete all[old]
  try {
    localStorage.setItem(OPENINGS_KEY, JSON.stringify(all))
  } catch {
    /* storage full: this book is not learnt from */
  }
}

/** the user's name for a book: its kept opening lines learn from it once, and are let go */
export function learnLinesOf(id: string, name: BookName, author: string) {
  const all = openings()
  const o = all[id]
  if (!o) return
  learnLines(o.lines, name, author, { author: o.author, title: o.title })
  delete all[id]
  try {
    localStorage.setItem(OPENINGS_KEY, JSON.stringify(all))
  } catch {
    /* nothing to let go of */
  }
}
