// The identification's word tagger. The line classifier (lineModel) tags a whole line, but a title page often prints
// several parts on one line: "הארי פוטר 3 והאסיר מאזקבאן מאת ג'יי קיי רולינג", "גנב הברק / ריק ריירדן", "© 2005 הוצאת ...".
// This tags each word of such a line as the title, the author, the series, the number, the year or noise, and the
// line is then split at the places the tag changes, so the line classifier meets one part at a time.
// It is a small softmax regression over hashed facts about the word (its letters, its ending, its shape, the words
// around it, the tags just before it, whether it is part of a name the library or the bundled series list holds), a
// few tens of kilobytes that run at once on any phone, with no server and no download. It starts from the weights
// learnt from generated lines (wordModel/weights.json, `npm run train:words`) and keeps learning on the device: a
// name the user approves or saves tags the words of that book's opening, and each tagged word is one training step.

import { bookLine, CREDIT, NOT_A_NAME, people } from './bookName'
import { norm } from './sameBook'
import { bundledLists } from './seriesDb'
import WORD_WEIGHTS from './wordModel/weights.json'

export const WORD_TAGS = ['title', 'author', 'series', 'number', 'year', 'noise'] as const
export type WordTag = (typeof WORD_TAGS)[number]
const T = WORD_TAGS.length
const NOISE = WORD_TAGS.indexOf('noise')

/** the number of buckets the facts are hashed into */
export const DIM = 4096

// a word (letters, digits, and the marks inside one: ג'יי, ת.ד, בן-גוריון, 3.5) or any other single character
const TOKEN = /[\p{L}\p{M}\p{N}]+(?:(?:['׳"״־.]|(?<=\p{L})-)[\p{L}\p{M}\p{N}]+)*['׳.]?|[^\s\p{L}\p{N}]/gu

interface Token {
  text: string
  start: number
  end: number
  /** a word (letters or digits), not a mark between words */
  word: boolean
}

export function tokenize(line: string): Token[] {
  return [...line.matchAll(TOKEN)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length, word: /[\p{L}\p{N}]/u.test(m[0]) }))
}

/** what the library and the bundled series list already know, as names folded for comparing */
export interface Gazetteer {
  authors: Set<string>
  series: Set<string>
  titles: Set<string>
}

interface WordContext {
  /** the library's authors and series (their names) */
  authors?: Iterable<string>
  series?: Iterable<string>
}

export function gazetteerOf(ctx: WordContext = {}): Gazetteer {
  const g: Gazetteer = { authors: new Set(), series: new Set(), titles: new Set() }
  const addAuthor = (a?: string) => {
    const p = a ? people(a) : ''
    if (p.split(' ').length >= 2) g.authors.add(p)
  }
  for (const a of ctx.authors ?? []) addAuthor(a)
  for (const s of ctx.series ?? []) if (norm(s).split(' ').length >= 2) g.series.add(norm(s))
  for (const l of bundledLists('')) {
    addAuthor(l.author)
    if (norm(l.series).split(' ').length >= 2) g.series.add(norm(l.series))
    for (const b of l.books) if (norm(b.title).split(' ').length >= 2) g.titles.add(norm(b.title))
  }
  return g
}

// ---- the facts about a word

const AUTHOR_CUE = /^(?:מאת|by|מחבר|מחברת|written)$/iu
const BOOK_CUE = /^(?:ה?ספר|ה?כרך|book|vol|volume|part|ה?חלק|ה?פרק)$/iu
const SERIES_CUE = /^(?:ב?סדרת|ב?סדרה|series|saga|trilogy|טרילוגיית|טרילוגיה)$/iu
const CREDIT_CUE = /^(?:תרגום|תרגמה|תרגם|הוצאת|הוצאה|עריכה|עריכת|עורך|עורכת|עיצוב|עטיפה|איור|מאנגלית|translated|edited|illustrated|cover|copyright|isbn|rights|reserved|publishing|press|books|ספרי|ספריית)$/iu
const PRAISE_CUE = /^(?:רב|רבי|מכר|bestseller|bestselling|award|פרס|זוכה|מצליח|המצליחה)$/iu
const ORDINAL = /^ה?(?:ראשו(?:ן|נה)|שני(?:ה|יה)?|שלישי(?:ת)?|רביעי(?:ת)?|חמישי(?:ת)?|שישי(?:ת)?|שביעי(?:ת)?|שמיני(?:ת)?|תשיעי(?:ת)?|עשירי(?:ת)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)$/iu
const FUNCTION_WORD = /^(?:של|על|את|עם|בין|כמו|לא|אין|כל|אל|אחרי|לפני|או|גם|רק|עד|the|of|and|a|an|in|to|for|on|with|at)$/iu
const ROMAN = /^[IVXivx]{1,5}$/u

/** a word with the one-letter prefix (ה, ו, ב, ל, מ, כ, ש) taken off, so that "והאסיר" and "האסיר" share their facts */
const stem = (n: string) => (n.length >= 4 && /^[הובלמכש]/u.test(n) ? n.slice(1) : n)

function shapeOf(text: string): string {
  if (/^\d+$/.test(text)) {
    const n = Number(text)
    return text.length === 4 && n >= 1500 && n <= 2100 ? 'year' : text.length <= 3 ? 'digits' : 'bigdigits'
  }
  if (/\d/.test(text)) return 'hasdigit'
  if (/^#/.test(text)) return 'hash'
  if (/^[\p{L}]['׳.]$/u.test(text)) return 'initial'
  if (ROMAN.test(text)) return 'roman'
  if (!/\p{L}/u.test(text)) return `mark:${text}`
  if (/^[A-Za-z]/.test(text)) return text === text.toUpperCase() && text.length > 1 ? 'LATIN' : /^[A-Z]/.test(text) ? 'Latin' : 'latin'
  return 'hebrew'
}

function categoryOf(n: string, text: string): string {
  if (AUTHOR_CUE.test(text)) return 'byCue'
  if (SERIES_CUE.test(text)) return 'seriesCue'
  if (BOOK_CUE.test(text)) return 'bookCue'
  if (ORDINAL.test(n) || ORDINAL.test(text)) return 'ordinal'
  if (CREDIT_CUE.test(text) || CREDIT_CUE.test(n)) return 'creditCue'
  if (PRAISE_CUE.test(text)) return 'praiseCue'
  if (FUNCTION_WORD.test(text)) return 'function'
  return ''
}

/** the words of a line that the library or the bundled list know as a name: one flag per word */
export function known(tokens: readonly Token[], g: Gazetteer): { author: boolean[]; series: boolean[]; title: boolean[] } {
  const out = { author: tokens.map(() => false), series: tokens.map(() => false), title: tokens.map(() => false) }
  const idx = tokens.flatMap((t, i) => (t.word ? [i] : []))
  for (let a = 0; a < idx.length; a++) {
    for (let len = Math.min(8, idx.length - a); len >= 2; len--) {
      const span = idx.slice(a, a + len)
      const words = span.map((i) => tokens[i]!.text)
      const asName = norm(words.join(' '))
      const asPerson = people(words.join(' '))
      const hit = (kind: 'author' | 'series' | 'title', set: Set<string>, key: string) => {
        if (!set.has(key)) return
        for (const i of span) out[kind][i] = true
      }
      hit('author', g.authors, asPerson)
      hit('series', g.series, asName)
      hit('title', g.titles, asName)
    }
  }
  return out
}

/** the hashed facts about word `i` that do not depend on the tags before it */
function baseFacts(tokens: readonly Token[], i: number, k: ReturnType<typeof known>, lineIndex: number): number[] {
  const f: string[] = ['bias']
  const at = (j: number) => tokens[j]
  const t = tokens[i]!
  const n = norm(t.text)
  const s = stem(n)
  const shape = shapeOf(t.text)
  const cat = categoryOf(n, t.text)
  f.push(`w=${s}`, `shape=${shape}`, `cat=${cat}`)
  if (n.length >= 3) f.push(`p2=${n.slice(0, 2)}`, `s2=${n.slice(-2)}`, `s3=${n.slice(-3)}`)
  if (n.length >= 4) f.push(`s4=${n.slice(-4)}`)
  if (/[\u05D0-\u05EA]{3,}(?:ים|ות)$/u.test(n)) f.push('plural')
  if (/^[הובלמכש]/u.test(n) && n.length >= 4) f.push(`pre=${n[0]}`)
  if (/^[ובלמכ]?ה[\u05D0-\u05EA]{2,}/u.test(n)) f.push('definite')
  if (/["״“”„]/.test(t.text)) f.push('quote')
  if (k.author[i]) f.push('gzA')
  if (k.series[i]) f.push('gzS')
  if (k.title[i]) f.push('gzT')
  if (k.author[i] && !k.author[i - 1]) f.push('gzA:b')
  if (k.title[i] && !k.title[i - 1]) f.push('gzT:b')
  if (k.series[i] && !k.series[i - 1]) f.push('gzS:b')
  for (const d of [-2, -1, 1, 2]) {
    const o = at(i + d)
    if (!o) {
      f.push(`${d}:edge`)
      continue
    }
    const on = norm(o.text)
    f.push(`${d}w=${stem(on)}`, `${d}shape=${shapeOf(o.text)}`)
    const c = categoryOf(on, o.text)
    if (c) f.push(`${d}cat=${c}`)
    if (Math.abs(d) === 1) {
      if (k.author[i + d]) f.push(`${d}gzA`)
      if (k.series[i + d]) f.push(`${d}gzS`)
      if (k.title[i + d]) f.push(`${d}gzT`)
    }
  }
  const words = tokens.filter((x) => x.word).length
  const wordIndex = tokens.slice(0, i).filter((x) => x.word).length
  f.push(`pos=${Math.min(wordIndex, 7)}`, `rpos=${Math.min(words - 1 - wordIndex, 7)}`, `len=${Math.min(words, 12)}`, `line=${Math.min(lineIndex, 5)}`)
  if (i === 0) f.push('first')
  if (i === tokens.length - 1) f.push('last')
  return f.map(hash)
}

/** the hashed facts about word `i` that depend on the tags of the two words before it (undefined or -1: the line's start) */
function tagFacts(token: Token, p2: number | undefined, p1: number | undefined): number[] {
  const name = (t: number | undefined) => (t === undefined || t < 0 ? 'start' : WORD_TAGS[t])
  const f = [`t1=${name(p1)}`, `t2=${name(p2)}|${name(p1)}`]
  if (p1 !== undefined && p1 >= 0) f.push(`t1w=${WORD_TAGS[p1]}|${stem(norm(token.text))}`)
  return f.map(hash)
}

/** the hashed facts about word `i`, given the tags the words before it are taken to have */
export function wordFacts(tokens: readonly Token[], i: number, before: readonly number[], k: ReturnType<typeof known>, lineIndex = 0): number[] {
  return [...baseFacts(tokens, i, k, lineIndex), ...tagFacts(tokens[i]!, before[i - 2], before[i - 1])]
}

function hash(s: string): number {
  let x = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i)
    x = Math.imul(x, 0x01000193)
  }
  return (x >>> 0) % DIM
}

// ---- the model

/** the weights the model starts from: DIM rows of one weight per tag */
export type Table = Float32Array

/** the bundled weights: bucket → one weight per tag (a bucket the file leaves out weighs nothing) */
function tableOf(data: Record<string, readonly number[]> = WORD_WEIGHTS.w): Table {
  const w = new Float32Array(DIM * T)
  for (const [b, row] of Object.entries(data)) {
    const base = Number(b) * T
    if (Number.isInteger(Number(b)) && Number(b) >= 0 && Number(b) < DIM && row.length === T) row.forEach((x, t) => (w[base + t] = Number.isFinite(x) ? x : 0))
  }
  return w
}

function scores(w: Table, delta: Record<number, number[]> | undefined, facts: readonly number[]): number[] {
  const z = new Array<number>(T).fill(0)
  for (const b of facts) {
    const d = delta?.[b]
    for (let t = 0; t < T; t++) z[t]! += w[b * T + t]! + (d?.[t] ?? 0)
  }
  return z
}

function softmax(z: readonly number[]): number[] {
  const top = Math.max(...z)
  const e = z.map((v) => Math.exp(v - top))
  const sum = e.reduce((a, b) => a + b, 0)
  return e.map((v) => v / sum)
}

/** one step of the softmax regression for a tagged word: the weights of the facts move toward the tag */
export function step(w: Table, facts: readonly number[], tag: number, rate: number, l2 = 0, start?: Table): void {
  const p = softmax(scores(w, undefined, facts))
  for (const b of new Set(facts)) {
    for (let t = 0; t < T; t++) {
      const i = b * T + t
      w[i]! += rate * ((t === tag ? 1 : 0) - p[t]! - l2 * (w[i]! - (start?.[i] ?? 0)))
    }
  }
}

const KEY = 'reader:identify:words'
const RATE = 0.2
const DECAY = 60
const STORED_MAX = 1500

interface Learnt {
  n: number
  d: Record<number, number[]>
}

let base: Table | undefined
const baseTable = () => (base ??= tableOf())

function load(): Learnt {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Learnt | null
    if (v && Number.isFinite(v.n) && v.d && typeof v.d === 'object') return v
  } catch {
    /* unreadable: start again from the bundled weights */
  }
  return { n: 0, d: {} }
}

function save(m: Learnt) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* storage unavailable: learnt until the app closes at most */
  }
}

interface Tagged {
  token: Token
  tag: WordTag
  /** the chance of that tag */
  p: number
}

/** a reading of a whole line: the tag of each token, the chance the model gives each of them, and the chance of all of
 *  them together (its log) */
interface Path {
  tags: number[]
  p: number[]
  logp: number
}

/**
 * The best readings of a line as a whole (Viterbi, over the tags of the two words before each word): rather than taking
 * each word's best tag in turn and then living with it, every sequence of tags is weighed by the chance of the whole, so
 * a word the model was unsure of is decided by the words after it too. `best` readings, the likeliest first.
 */
function decode(tokens: readonly Token[], k: ReturnType<typeof known>, lineIndex: number, delta: Record<number, number[]> | undefined, w: Table, best = 2): Path[] {
  type Entry = { logp: number; back?: { state: number; rank: number }; tag: number; p: number }
  const S = T + 1
  const stateOf = (a: number, b: number) => (a + 1) * S + (b + 1)
  let layer = new Map<number, Entry[]>([[stateOf(-1, -1), [{ logp: 0, tag: -1, p: 1 }]]])
  const layers: Map<number, Entry[]>[] = []
  tokens.forEach((token, i) => {
    const base = scores(w, delta, baseFacts(tokens, i, k, lineIndex))
    const next = new Map<number, Entry[]>()
    for (const [state, entries] of layer) {
      const a = Math.floor(state / S) - 1
      const b = (state % S) - 1
      const extra = scores(w, delta, tagFacts(token, a, b))
      const p = softmax(base.map((z, t) => z + extra[t]!))
      entries.forEach((e, rank) => {
        for (let c = 0; c < T; c++) {
          const to = stateOf(b, c)
          const list = next.get(to) ?? []
          list.push({ logp: e.logp + Math.log(p[c]!), back: { state, rank }, tag: c, p: p[c]! })
          next.set(to, list)
        }
      })
    }
    for (const [state, list] of next) next.set(state, list.sort((x, y) => y.logp - x.logp).slice(0, best))
    layers.push(next)
    layer = next
  })
  if (!layers.length) return []
  const ends = [...layer].flatMap(([state, list]) => list.map((e, rank) => ({ state, rank, e }))).sort((x, y) => y.e.logp - x.e.logp).slice(0, best)
  return ends.map(({ state, rank, e }) => {
    const tags: number[] = []
    const p: number[] = []
    let at: { state: number; rank: number } | undefined = { state, rank }
    for (let i = layers.length - 1; i >= 0 && at; i--) {
      const x: Entry = layers[i]!.get(at.state)![at.rank]!
      tags.unshift(x.tag)
      p.unshift(x.p)
      at = x.back
    }
    return { tags, p, logp: e.logp }
  })
}

/** the tag of each token of a line, by the likeliest reading of the whole line */
export function tagWords(
  line: string,
  ctx: WordContext = {},
  lineIndex = 0,
  g: Gazetteer = gazetteerOf(ctx),
  delta: Record<number, number[]> = load().d,
  w: Table = baseTable(),
): Tagged[] {
  return readings(line, ctx, lineIndex, g, delta, w)[0] ?? []
}

/** the two likeliest readings of a line, each as its tagged tokens */
function readings(
  line: string,
  ctx: WordContext = {},
  lineIndex = 0,
  g: Gazetteer = gazetteerOf(ctx),
  delta: Record<number, number[]> = load().d,
  w: Table = baseTable(),
): (Tagged[] & { logp?: number })[] {
  const tokens = tokenize(line)
  return decode(tokens, known(tokens, g), lineIndex, delta, w).map((path) =>
    Object.assign(
      tokens.map((token, i) => ({ token, tag: WORD_TAGS[path.tags[i]!]!, p: path.p[i]! })),
      { logp: path.logp },
    ),
  )
}

// ---- the parts of a line

export interface Part {
  tag: WordTag
  text: string
  /** the least chance among its words */
  p: number
}

/** the runs of one tag in a tagged line: noise between two words of one part (a comma, a dash) stays in it, the marks at
 *  its ends do not; the cue before an author or a series ("מאת", "בסדרת") is kept with the part after it, as the line classifier reads it */
export function partsOf(line: string, tagged: readonly Tagged[]): Part[] {
  const parts: { tag: WordTag; from: number; to: number; p: number }[] = []
  for (const x of tagged) {
    if (!x.token.word && x.tag === 'noise') continue
    const last = parts[parts.length - 1]
    if (last && last.tag === x.tag) {
      last.to = x.token.end
      last.p = Math.min(last.p, x.p)
    } else parts.push({ tag: x.tag, from: x.token.start, to: x.token.end, p: x.p })
  }
  // a mark tagged as part of a run but left at its edge (an opening quote after the cue)
  const out = parts.map((q) => ({ tag: q.tag, text: line.slice(q.from, q.to).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.'׳"״]+$/gu, '').trim(), p: q.p }))
  for (let i = 1; i < out.length; i++) {
    const cue = out[i - 1]!
    // the cue says what the part after it is, whatever the tagger took it for: \"בסדרת\" before a name it read as a title
    if (cue.tag !== 'noise' || out[i]!.tag === 'noise' || out[i]!.tag === 'year') continue
    const last = cue.text.split(' ').pop()!
    if (AUTHOR_CUE.test(last) || SERIES_CUE.test(last)) out[i]!.text = `${last} ${out[i]!.text}`
  }
  return out.filter((q) => q.text)
}

/** the pieces a reading cuts a line into, the way the line classifier reads them; undefined when the reading does not
 *  split it (fewer than two different parts of a name, or one of title, author and series twice) */
export function piecesOf(line: string, tagged: readonly Tagged[]): string[] | undefined {
  // a word the cut would drop has to be a cue (\"מאת\", \"בסדרת\", \"by\") or a year: any other word of the line is part of a
  // name the tagger was not sure of, and the line is left whole
  if (tagged.some((x) => x.token.word && x.tag === 'noise' && !AUTHOR_CUE.test(x.token.text) && !SERIES_CUE.test(x.token.text))) return undefined
  const content = partsOf(line, tagged).filter((q) => q.tag === 'title' || q.tag === 'author' || q.tag === 'series' || q.tag === 'number')
  if (new Set(content.map((q) => q.tag)).size < 2) return undefined
  // each tag once: a name with two titles in one line is not told apart by this
  if (['title', 'author', 'series'].some((tag) => content.filter((q) => q.tag === tag).length > 1)) return undefined
  // a number is a book line (\"ספר שלישי\", \"כרך 2\"), a number or an ordinal, and nothing more: a word beside it that it
  // took in (\"ספר 3 בסדרת\") is a cut in the wrong place
  // a piece of a name that still holds a book's number between its words (\"עולם הדיסק 9 אריק\") or half of a parenthesis
  // (\"ראי-נוע ( עולם הדיסק\") was not cut where it should be: the line is left whole
  const unbalanced = (t: string) => (t.match(/\(/g)?.length ?? 0) !== (t.match(/\)/g)?.length ?? 0)
  if (content.some((q) => q.tag !== 'number' && (/\s#?\d{1,3}\s/.test(` ${q.text.replace(/^\d+\s/, '')} `.slice(1)) || unbalanced(q.text)))) return undefined
  if (content.some((q) => q.tag === 'number' && !bookLine(q.text) && !/^#?\d{1,3}$/.test(q.text) && !ORDINAL.test(norm(q.text)))) return undefined
  return content.map((q) => {
    if (q.tag !== 'number') return q.text
    const read = bookLine(q.text)?.number ?? /\d{1,3}/.exec(q.text)?.[0]
    return read && !bookLine(q.text) ? `ספר ${read}` : q.text
  })
}

/** no word of the reading a line is split by may be under this chance */
const SPLIT_FLOOR = 0.5
/** when the second reading cuts the line elsewhere, the first has to be this many times likelier */
const SPLIT_RATIO = 3

/**
 * A line that prints several parts, split into them: "הארי פוטר 3 והאסיר מאזקבאן מאת ג'יי קיי רולינג" is the series, the
 * book's number ("ספר 3"), the title, and the author with his cue. The line is read whole (decode), and its two likeliest
 * readings are both kept: when they cut the line at the same places it is split even if they differ in what a piece is
 * (the series or the title, "גנב הברק / ריק ריירדן"), for the line classifier tells that afterwards; when they cut it at
 * different places, only a first reading far likelier than the second splits it. A credit, an address or a sentence is
 * never split, and anything less than sure leaves the line as it was, as the line classifier read it before.
 */
export function splitLine(line: string, ctx: WordContext = {}, lineIndex = 0, g?: Gazetteer, delta?: Record<number, number[]>, w?: Table): string[] {
  const tokens = tokenize(line)
  if (tokens.filter((t) => t.word).length < 3 || CREDIT.test(line) || NOT_A_NAME.test(line)) return [line]
  const [first, second] = readings(line, ctx, lineIndex, g, delta, w)
  const cut = first && piecesOf(line, first)
  if (!cut) return [line]
  const other = second && piecesOf(line, second)
  // both readings cut the line at the same places: it is cut there, whatever each piece is
  if (other && other.join('\u0001') === cut.join('\u0001')) return cut
  if (first.some((x) => x.p < SPLIT_FLOOR)) return [line]
  if (second && first.logp! - second.logp! < Math.log(SPLIT_RATIO)) return [line]
  return cut
}

/**
 * The year a book's opening prints apart from a copyright line (\"הוצאת כתר 2005\", \"מהדורה ראשונה, 2010\"), as the tagger
 * reads it: a word it tags as a year and is sure of, on a short line of the copyright page (a credit, or beside one), before
 * the text's first chapter, that is not a sentence. When several
 * are printed (the editions after the first), the earliest. Undefined when none.
 */
export function taggedYear(opening: readonly string[], ctx: WordContext = {}): number | undefined {
  const g = gazetteerOf(ctx)
  let year: number | undefined
  // the text begins at its first chapter: a year after it is the story's, not the book's
  const lines = opening.slice(0, 40)
  const text = lines.findIndex((l) => /^\s*(?:פרק|פרולוג|הקדמה|תוכן|chapter|prologue|contents)(?![\p{L}])/iu.test(l))
  const page = text < 0 ? lines : lines.slice(0, text)
  page.forEach((raw, li) => {
    // only on the copyright page: a line that is a credit, or beside one (the publisher, the edition, the translator)
    if (!page.slice(Math.max(0, li - 2), li + 3).some((l) => CREDIT.test(l))) return
    const line = raw.replace(/[.\s]+$/u, '').trim()
    const words = tokenize(line).filter((t) => t.word).length
    if (words < 2 || words > 10 || NOT_A_NAME.test(line) || !/\b1[5-9]\d\d\b|\b20\d\d\b/.test(line)) return
    for (const x of tagWords(line, ctx, Math.min(li, 5), g)) {
      if (x.tag !== 'year' || x.p < 0.9) continue
      const y = Number(x.token.text)
      if (y >= 1500 && y <= new Date().getFullYear() + 1 && !(year! <= y)) year = y
    }
  })
  return year
}

// ---- what the user taught it

/** the tag each word of a line has by the name the book is known to have; undefined for a line that cannot be told (a
 *  name the answer leaves out may be on it) */
export function tagByName(line: string, name: { title?: string; series?: string; number?: string }, author = ''): (WordTag | undefined)[] | undefined {
  const tokens = tokenize(line)
  const out: (WordTag | undefined)[] = tokens.map(() => undefined)
  const words = tokens.flatMap((t, i) => (t.word ? [i] : []))
  const place = (target: string, tag: WordTag, fold: (s: string) => string) => {
    const want = fold(target).split(' ').filter(Boolean)
    if (!want.length) return false
    for (let a = 0; a + want.length <= words.length; a++) {
      if (want.every((x, j) => fold(tokens[words[a + j]!]!.text) === x) && words.slice(a, a + want.length).every((i) => out[i] === undefined)) {
        for (let i = words[a]!; i <= words[a + want.length - 1]!; i++) out[i] = tag
        return true
      }
    }
    return false
  }
  const found = [place(author, 'author', people), place(name.title ?? '', 'title', norm), place(name.series ?? '', 'series', norm)].some(Boolean)
  const marks = tokens.flatMap((t, i) => (out[i] === undefined && t.word ? [i] : []))
  for (const i of marks) {
    const text = tokens[i]!.text
    const n = norm(text)
    if (name.number && /^\d{1,3}$/.test(text) && Number(text) === Number(name.number)) out[i] = 'number'
    else if (shapeOf(text) === 'year') out[i] = 'year'
    else if (BOOK_CUE.test(text) || ORDINAL.test(n)) out[i] = found ? 'number' : undefined
    else if (AUTHOR_CUE.test(text) || SERIES_CUE.test(text) || CREDIT_CUE.test(text) || PRAISE_CUE.test(text)) out[i] = found ? 'noise' : undefined
  }
  if (!found && (CREDIT.test(line) || NOT_A_NAME.test(line))) return tokens.map(() => 'noise')
  if (!found) return undefined
  // the marks between two words of one tag are part of it, the others are noise
  return out.map((tag, i) => {
    if (tag) return tag
    if (tokens[i]!.word) return undefined
    const before = out.slice(0, i).reverse().find((x) => x !== undefined)
    const after = out.slice(i + 1).find((x) => x !== undefined)
    return before && before === after && (before === 'title' || before === 'series') ? before : 'noise'
  })
}

/** the user approved or saved this name for a book whose opening lines are these: each line it tags is a step */
export function learnWords(lines: readonly string[], name: { title?: string; series?: string; number?: string }, author: string, ctx: WordContext = {}) {
  const g = gazetteerOf(ctx)
  const m = load()
  let learnt = 0
  lines.slice(0, 15).forEach((line, li) => {
    const gold = tagByName(line, name, author)
    if (!gold || !gold.some((t) => t === 'title' || t === 'author')) return
    const tokens = tokenize(line)
    const k = known(tokens, g)
    const before = gold.map((t) => (t === undefined ? NOISE : WORD_TAGS.indexOf(t)))
    tokens.forEach((_, i) => {
      const tag = gold[i]
      if (!tag) return
      const facts = wordFacts(tokens, i, before, k, li)
      const p = softmax(scores(baseTable(), m.d, facts))
      const rate = RATE / (1 + m.n / DECAY)
      const want = WORD_TAGS.indexOf(tag)
      for (const b of new Set(facts)) {
        const row = (m.d[b] ??= new Array<number>(T).fill(0))
        for (let t = 0; t < T; t++) row[t]! += rate * ((t === want ? 1 : 0) - p[t]! - 0.01 * row[t]!)
      }
      m.n++
      learnt++
    })
  })
  if (!learnt) return
  // what it keeps is bounded: the buckets it moved least go first
  const keys = Object.keys(m.d)
  if (keys.length > STORED_MAX) {
    const size = (b: string) => Math.max(...m.d[Number(b)]!.map(Math.abs))
    for (const b of keys.sort((x, y) => size(x) - size(y)).slice(0, keys.length - STORED_MAX)) delete m.d[Number(b)]
  }
  save(m)
}

/** how many words the tagger has learnt from on this device, for the stats */
export function wordsReport(): number {
  return load().n
}
