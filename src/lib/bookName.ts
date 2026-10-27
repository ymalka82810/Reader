// The library's naming template for a book: "series number - title", e.g. "פרסי ג'קסון 1 - גנב הברק". The number may carry
// words of its own ("הערפילאים 2 העידן הראשון - האימפריה האחרונה"), and the title may hold dashes of its own
// ("שיר של אש ושל קרח 3 - סופת החרבות, חלק ראשון - פלדה ושלג"). A book outside a series is named by its title alone.

import { bookNumber } from './bookInference'

export interface BookName {
  series: string
  /** the book's place in the series: "1", or with words that follow it, "2 העידן הראשון" */
  number: string
  title: string
}

// the right-to-left mark formatBookName puts between a series that ends in a Latin letter and its number
const RLM = '\u200F'
const clean = (s: string) => s.replace(/[\u200E\u200F]/g, '').replace(/\s+/g, ' ').trim()

/** No real book name comes close to this; a longer text (a corrupt title, a pasted paragraph) is cut before it is parsed,
 *  because some of the patterns below slow down sharply on very long input. */
const MAX_NAME = 500
const cap = (s: string) => (s.length > MAX_NAME ? s.slice(0, MAX_NAME) : s)

/** the name in the template. In a Hebrew name, a series that ends in a Latin letter ("פרויקט X") gets a right-to-left
 *  mark before its number, or the screen shows "פרויקט 5 X": the "X 5" would read as one left-to-right run. */
export function formatBookName({ series, number, title }: BookName): string {
  const s = clean(series)
  const n = clean(number)
  const name = clean(title)
  if (!s) return name
  const mark = /[A-Za-z]$/.test(s) && /[\u0590-\u05FF]/.test(s + name) ? RLM : ''
  const head = n ? `${s}${mark} ${n}` : s
  return name ? `${head} - ${name}` : head
}

// a series number has up to three digits, so a year in a title ("1984", "מלחמת 1948") is not taken for one
const TEMPLATE = /^(.+?)\s+(\d{1,3}(?:\s+[^\s\-–—][^\-–—]*?)?)\s+[-–—]\s+(.+)$/u

/** A name already in the template, split into its parts; any other name is all title. formatBookName undoes it. */
export function splitBookName(name: string): BookName {
  name = cap(name)
  const m = TEMPLATE.exec(clean(name))
  if (m) return { series: m[1]!, number: m[2]!, title: m[3]! }
  return { series: '', number: '', title: clean(name) }
}

const ORDINALS: [RegExp, string][] = [
  [/^ראשו(?:ן|נה)$/u, '1'],
  [/^שני(?:ה|יה)?$/u, '2'],
  [/^שלישי(?:ת)?$/u, '3'],
  [/^רביעי(?:ת)?$/u, '4'],
  [/^חמישי(?:ת)?$/u, '5'],
  [/^שישי(?:ת)?$/u, '6'],
  [/^שביעי(?:ת)?$/u, '7'],
  [/^שמיני(?:ת)?$/u, '8'],
  [/^תשיעי(?:ת)?$/u, '9'],
  [/^עשירי(?:ת)?$/u, '10'],
  [/^first$/i, '1'],
  [/^second$/i, '2'],
  [/^third$/i, '3'],
  [/^fourth$/i, '4'],
  [/^fifth$/i, '5'],
  [/^sixth$/i, '6'],
  [/^seventh$/i, '7'],
  [/^eighth$/i, '8'],
  [/^ninth$/i, '9'],
  [/^tenth$/i, '10'],
  [/^one$/i, '1'],
  [/^two$/i, '2'],
  [/^three$/i, '3'],
  [/^four$/i, '4'],
  [/^five$/i, '5'],
  [/^six$/i, '6'],
  [/^seven$/i, '7'],
  [/^eight$/i, '8'],
  [/^nine$/i, '9'],
  [/^ten$/i, '10'],
]

const LETTERS: Record<string, number> = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ל: 30, מ: 40, נ: 50, ס: 60, ע: 70, פ: 80, צ: 90 }

/** a number in Hebrew letters: ג' is 3, י"א is 11, כ״ב is 22, ט"ו is 15; up to 99, undefined for anything else */
export function letterNumber(word: string): number | undefined {
  const one = /^([\u05D0-\u05EA])['׳]$/u.exec(word)
  if (one) return LETTERS[one[1]!]
  const two = /^([\u05D0-\u05EA])["״]([\u05D0-\u05EA])$/u.exec(word)
  if (!two) return undefined
  const tens = LETTERS[two[1]!]
  const units = LETTERS[two[2]!]
  // tens before units, as the letters are written (י"א, never א"י); 15 and 16 are ט"ו and ט"ז
  if (tens === 9 && (units === 6 || units === 7)) return 9 + units
  return tens && units && tens >= 10 && units < 10 ? tens + units : undefined
}

/** "3", "03", "#3", "ג'", "שלישי" or "third" as "3"; undefined for anything else */
function numberOf(word: string): string | undefined {
  const w = word.replace(/^#/, '')
  if (/^\d{1,3}(?:\.5)?$/.test(w)) return String(Number(w))
  const letters = letterNumber(w)
  if (letters) return String(letters)
  // "השלישי" is "שלישי" with the article
  const bare = /^ה[\u05D0-\u05EA]{3,}$/u.test(w) ? w.slice(1) : w
  return ORDINALS.find(([re]) => re.test(w) || re.test(bare))?.[1]
}

// a number in Hebrew letters ("ג'", "י"א"); see letterNumber
const LETTER_NUM = String.raw`[\u05D0-\u05EA]['׳]|[\u05D0-\u05EA]["״][\u05D0-\u05EA]`
// a novella between two books is numbered by a half ("2.5"), a prequel "0.5"
const DIGITS = String.raw`\d{1,3}(?:\.5)?`
const NUM = String.raw`(#?${DIGITS}|${LETTER_NUM}|[\p{L}]+)`
const DASH = String.raw`[-–—:,.]`
// "חלק" is left out on purpose: it is part of many titles ("סופת החרבות, חלק ראשון")
const BOOK_WORD = String.raw`(?:ספר|כרך|פרק|book|part|vol\.?|volume)`

/** "פרסי ג'קסון, ספר 1", "פרסי ג'קסון #1", "Mistborn 1", "ספר ראשון בסדרת פרסי ג'קסון", "Book 1 of Mistborn":
 *  a series and the book's number in it */
export function seriesOf(text: string): { series: string; number: string } | undefined {
  const s = clean(text)
  const tries: [RegExp, number, number][] = [
    [new RegExp(String.raw`^${BOOK_WORD}\s+${NUM}\s+(?:ב?סדרת|בסדרה|מתוך|of(?: the)?|in(?: the)?)\s+(.+)$`, 'iu'), 2, 1],
    [new RegExp(String.raw`^(.+?)(?:\s*${DASH}\s*|\s+)${BOOK_WORD}\s+${NUM}$`, 'iu'), 1, 2],
    [new RegExp(String.raw`^(.+?)\s*,?\s+(#?${DIGITS}|${LETTER_NUM})$`, 'u'), 1, 2],
  ]
  for (const [re, si, ni] of tries) {
    const m = re.exec(s)
    const number = m && numberOf(m[ni]!)
    const series = m && clean(m[si]!.replace(/\s*[-–—:,]\s*$/, ''))
    if (number && series) return { series, number }
  }
  return undefined
}

/** "ספר 3 - קללת הטיטאן": a "series" that is only the word for a book or a part is no series, and its number says
 *  nothing without one; the title alone is left */
function partOnly(n: BookName): BookName {
  return /^(?:ה?ספר|ה?כרך|ה?חלק|ה?פרק|book|vol\.?|volume|part|chapter)$/iu.test(n.series) ? { series: '', number: '', title: n.title } : n
}

/**
 * Reads a series, number and title out of a free-form name: a file name, a book's own metadata or a catalog entry.
 * Understands the template itself and the common variants: "גנב הברק (פרסי ג'קסון #1)", "פרסי ג'קסון ספר 1: גנב הברק",
 * "פרסי ג'קסון - ספר ראשון - גנב הברק", "Mistborn 1: The Final Empire", with "_" for spaces. What it cannot read is the title.
 */
export function guessBookName(text: string): BookName {
  const s = clean(cap(text).replace(/_+/g, ' '))
  const plain = { series: '', number: '', title: s }
  if (!s) return plain

  // "גנב הברק (פרסי ג'קסון #1)", "The Final Empire (Mistborn, Book 1)"
  const paren = /^(.+?)\s*[([]([^()[\]]+)[)\]]$/u.exec(s)
  if (paren) {
    const inner = seriesOf(paren[2]!)
    if (inner) return { ...inner, title: clean(paren[1]!) }
  }

  // "פרסי ג'קסון ספר 1: גנב הברק", "פרסי ג'קסון - ספר ראשון - גנב הברק"
  const word = new RegExp(String.raw`^(.+?)(?:\s*${DASH}\s*|\s+)${BOOK_WORD}\s+${NUM}\s*${DASH}\s*(.+)$`, 'iu').exec(s)
  if (word) {
    const number = numberOf(word[2]!)
    const series = clean(word[1]!)
    if (number && series) return partOnly({ series, number, title: clean(word[3]!) })
  }

  // the number in Hebrew letters: "פרסי ג'קסון ג' - קללת הטיטאן"
  const lettered = new RegExp(String.raw`^(.+?)\s+(${LETTER_NUM})\s*(?:\s[-–—]|:)\s+(.+)$`, 'u').exec(s)
  if (lettered)
    // "שר הטבעות חלק ב' - שתי הצריחים": the word for a part before the letter is not the series' (it stays in a title)
    return partOnly({ series: clean(lettered[1]!.replace(/\s+חלק$/u, '')), number: String(letterNumber(lettered[2]!)), title: clean(lettered[3]!) })

  // the number in Roman numerals after a series in Latin letters: "Shadow Blade II - The End"
  const roman = /^([A-Za-z][^֐-׿]*?)\s+([IVX]{2,5})\s*(?:\s[-–—]|:)\s+(.+)$/u.exec(s)
  const romanNumber = roman && bookNumber(roman[2]!)
  if (roman && romanNumber) return { series: clean(roman[1]!), number: String(romanNumber), title: clean(roman[3]!) }

  // the template, also with "#1" or ":" ("Mistborn #1: The Final Empire")
  const tpl = new RegExp(String.raw`^(.+?)\s+#?(${DIGITS}(?:\s+[^\s\-–—:][^\-–—:]*?)?)\s*(?:\s[-–—]|:)\s+(.+)$`, 'u').exec(s)
  if (tpl) {
    const [num, ...rest] = tpl[2]!.split(' ')
    return partOnly({ series: clean(tpl[1]!), number: [numberOf(num!) ?? num, ...rest].join(' '), title: clean(tpl[3]!) })
  }

  return plain
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase()

/** a file name without the author it may carry ("גנב הברק - ריק ריירדן", "ריק ריירדן - גנב הברק") */
/** a name of people folded for comparing: "הולי בלק & קסנדרה קלייר" is "הולי בלק וקסנדרה קלייר" ("and" is "ו") */
const people = (s: string) =>
  fold(s.replace(/\s+(?:&|and)\s+/giu, ' ו').replace(/['׳"״]/gu, '')).replace(/(^| )ו(?=\p{L}{2})/gu, '$1')

/** "(טרי פראצט; Terry Pratchett)", "(טרי פראצט, Terry Pratchett)": an author's name in Hebrew and in English */
const AUTHOR_PAIR = /\s*\(\s*([^()]*[\u0590-\u05FF][^();,]*?)\s*[;,]\s*([A-Za-z][^()]*?)\s*\)/u

const MAX_AUTHOR_WORDS = 8

export function withoutAuthor(name: string, author: string): string {
  const a = people(author)
  if (!a) return name
  name = cap(name)
  // in parentheses: "המלך דוד (שרון חיון גינת)"
  name = clean(name.replace(/\s*\(([^()]+)\)/gu, (m, inner: string) => (people(inner) === a ? ' ' : m)))
  const parts = name.split(/\s+[-–—]\s+/)
  if (parts.length >= 2) {
    if (people(parts[parts.length - 1]!) === a) return parts.slice(0, -1).join(' - ')
    if (people(parts[0]!) === a) return parts.slice(1).join(' - ')
  }
  // the author's name run on at the end with no dash, as in a file name with underscores ("קוטל_המלכה_סבסטיאן_דה_קסטל")
  const words = clean(name).split(' ')
  // an author has a few words at most, so there is no need to try every suffix of a long name
  for (let k = 1; k < Math.min(words.length, MAX_AUTHOR_WORDS + 1); k++) if (people(words.slice(-k).join(' ')) === a) return words.slice(0, -k).join(' ')
  return gluedAuthor(words, author) ?? name
}

const lettersOf = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '')

/** The author's name run on to the title with no space at all ("שרוןחיוןגינתהלביאההלוחמת"): the first or the last word
 *  starts (or ends) with the author's letters and has something more. Undefined when it does not. */
function gluedAuthor(words: string[], author: string): string | undefined {
  const glued = lettersOf(clean(author))
  // a short name could be the start of any word
  if (glued.length < 6 || !words.length) return undefined
  // the word without its first `n` letters (what is between them, a quote or an underscore, goes with them)
  const dropFirst = (w: string, n: number) => {
    let seen = 0
    for (let i = 0; i < w.length; i++) if (/[\p{L}\p{N}]/u.test(w[i]!) && ++seen === n) return w.slice(i + 1).replace(/^[^\p{L}\p{N}]+/u, '')
    return ''
  }
  const first = words[0]!
  if (lettersOf(first).startsWith(glued) && lettersOf(first).length > glued.length) return clean([dropFirst(first, glued.length), ...words.slice(1)].join(' '))
  const last = words[words.length - 1]!
  if (lettersOf(last).endsWith(glued) && lettersOf(last).length > glued.length) {
    const keep = lettersOf(last).length - glued.length
    let seen = 0
    for (let i = 0; i < last.length; i++) if (/[\p{L}\p{N}]/u.test(last[i]!) && ++seen === keep) return clean([...words.slice(0, -1), last.slice(0, i + 1)].join(' '))
  }
  return undefined
}

/**
 * Words run together into one (\"הלביאההלוחמת\") split back into the words of `vocab`: the words the book, its cover and the
 * library use. A word may come with one of the joining letters in front (ה, ו, ב, ל, מ, ש, כ). The split with the fewest
 * words wins; undefined when the letters cannot all be made of known words.
 */
export function splitGlued(glued: string, vocab: ReadonlySet<string>): string | undefined {
  const text = lettersOf(glued)
  if (text.length < 4) return undefined
  const known = (w: string) => w.length >= 2 && (vocab.has(w) || (w.length >= 4 && /^[הובלמשכ]/u.test(w) && vocab.has(w.slice(1))))
  // best[i]: the fewest words that make the first i letters
  const best: (string[] | undefined)[] = Array.from({ length: text.length + 1 })
  best[0] = []
  for (let i = 1; i <= text.length; i++) {
    for (let j = Math.max(0, i - 14); j < i; j++) {
      const before = best[j]
      const piece = text.slice(j, i)
      if (before && known(piece) && (!best[i] || before.length + 1 < best[i]!.length)) best[i] = [...before, piece]
    }
  }
  const words = best[text.length]
  return words && words.length > 1 ? words.join(' ') : undefined
}

const latin = (s: string) => /[A-Za-z]/.test(s) && !/[\u0590-\u05FF]/.test(s)

/**
 * Cleans what file names and PDF metadata add around a book's name, before it is read: Drive's "עותק של" / "Copy of",
 * a trailing "(1)", an English translation in parentheses after a Hebrew name, an English name before a Hebrew one
 * ("The Trials of Apollo 4 - גורלו של אפולו 4, ..."), and the comma between the number and the title
 * ("גורלו של אפולו 1, האורקל הנסתר" -> "גורלו של אפולו 1 - האורקל הנסתר").
 */
const annasParts = (s: string) => {
  // "--", or a long dash put in its place ("—", "——", " – ")
  const parts = s.split(/\s*(?:-{2,}|—+|\s–\s)\s*/).map(clean)
  return parts.length >= 3 && /^anna['’]?s archive$/i.test(parts[parts.length - 1]!) ? parts : undefined
}

/** "title -- author -- series, n -- year -- publisher -- md5 -- Anna’s Archive" as the template ("series n - title") */
function annasArchive(s: string): string | undefined {
  const parts = annasParts(s)
  if (!parts) return undefined
  const title = parts[0]!
  for (const p of parts.slice(2, -1)) {
    if (!/\p{L}{2}/u.test(p) || /^[\da-f]{32}$/i.test(p)) continue // the year, the md5
    // "הרואים למרחק, 2", "…,2.", "… (2)", "… #2", "… כרך 2", or the number first: "2, הרואים למרחק"
    const m =
      /^(.+?)[\s\p{P}]+(?:(?:כרך|ספר|book|vol\.?)\s*)?#?(\d{1,3})[\s\p{P}]*$/iu.exec(p) ?? /^[\s\p{P}]*#?(\d{1,3})[\s\p{P}]+(.+)$/u.exec(p)
    if (!m) continue
    const [series, n] = /^\d/.test(m[1]!) ? [m[2]!, m[1]!] : [m[1]!, m[2]!]
    return `${clean(series)} ${Number(n)} - ${title}`
  }
  return title
}

const ZLIB = /\b(?:z-?library|z-?lib|1lib)\b/i

/** Z-Library names a file "title (author) (z-library.sk, …)": the parentheses that hold the author, a Hebrew name with no digits
 *  (its English spelling may follow a ";" or ","), or undefined for a name not from Z-Library */
function zlibAuthorParen(s: string): { inner: string; author: string } | undefined {
  if (!ZLIB.test(s)) return undefined
  const inners = [...s.matchAll(/\(([^()]+)\)/g)].map((m) => m[1]!).filter((p) => !ZLIB.test(p) && !/\d/.test(p) && /[א-ת]/.test(p))
  const inner = inners[inners.length - 1]
  const author = inner && clean(inner.split(/[;,]/).find((x) => /[א-ת]/.test(x)) ?? '')
  return inner && author && author.split(' ').length <= 5 ? { inner, author } : undefined
}

/** the author a download site's name carries: Anna's Archive's second part, Z-Library's parentheses; '' for any other name */
export function authorInName(s: string): string {
  // also the Hebrew of "(טרי פראצט; Terry Pratchett)"
  const name = clean(s.replace(/_+/g, ' '))
  const a = annasParts(name)?.[1] || AUTHOR_PAIR.exec(name)?.[1] || zlibAuthorParen(name)?.author || ''
  return /\p{L}{2}/u.test(a) ? clean(a) : ''
}

/** A name of a person as a file name writes it: two to four words of letters only (no digit, no "#", no mark of a part) */
function personShaped(s: string): boolean {
  const w = clean(s).split(' ')
  // initials count as words ("א ל ג'ייס"), but one word has to be a name and not only a letter
  return (
    w.length >= 2 &&
    w.length <= 4 &&
    w.every((x) => /^[\p{L}'׳".\u05F3\u05F4-]+$/u.test(x)) &&
    w.some((x) => /\p{L}{2}/u.test(x)) &&
    !/^(?:ה?חלק|ה?כרך|ה?ספר|part|vol\.?|volume|book)$/iu.test(w[0]!)
  )
}

/**
 * The author a plain "A - B" name carries when it says no author: the two parts are told apart by evidence, never by
 * a particular name. First an author the library already has (either side); then the shape: the side that is a
 * person's name (two to four words of letters only) while the other is not (a title with a digit, or one word). Both
 * sides alike in shape, or neither, tell nothing: ''.
 */
export function authorByDash(name: string, known: readonly string[] = []): string {
  const parts = clean(name.replace(/_+/g, ' ')).split(/\s+[-–—]\s+/)
  if (parts.length !== 2) return ''
  const [a, b] = parts as [string, string]
  // a name the template already reads as "series number - title" ("פרסי ג'קסון ג' - …", "… חלק ב' - …") has no author in it
  if (/\d/.test(a) || guessBookName(tidyBookName(name)).series) return ''
  const have = (x: string) => known.find((k) => people(k) === people(x))
  const ka = have(a)
  const kb = have(b)
  if (ka && !kb) return ka
  if (kb && !ka) return kb
  const pa = personShaped(a)
  const pb = personShaped(b)
  if (pa && !pb) return a
  if (pb && !pa) return b
  return ''
}

/** A title that is the series run together with no space, and perhaps the volume after it ("הלביאההלוחמתחלקא" of the
 *  series "הלביאה הלוחמת", a file name with no spaces): without the series, "חלק א'" or nothing. Any other title stays. */
export function unglued(title: string, series: string): string {
  const flat = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '')
  const s = flat(series)
  const t = flat(title)
  // one word only; a short series could start any word
  if (/\s/u.test(title.trim()) || s.length < 6 || !t.startsWith(s)) return title
  const rest = t.slice(s.length)
  if (!rest) return ''
  const part = /^חלק(?:([א-ד])|(ראשון|שני|שלישי|רביעי|חמישי))$/u.exec(rest)
  return part ? `חלק ${part[1] ? `${part[1]}'` : part[2]}` : title
}

export function tidyBookName(text: string): string {
  let s = clean(cap(text).replace(/_+/g, ' '))
  s = annasArchive(s) ?? s
  const zlib = zlibAuthorParen(s)
  if (zlib) s = s.replace(`(${zlib.inner})`, ' ')
  s = s
    .replace(/^(?:(?:עותק של|copy of)\s+)+/iu, '') // also "עותק של עותק של"
    .replace(/\.(?:md|txt|epub|pdf|docx?|fb2|mobi|azw3?)$/iu, '')
    // what a download site adds: "(Z-Library)", "(z-library.sk, 1lib.sk, z-lib.sk)", and a date and time stamp
    .replace(/\s*\((?:[^()]*\b(?:z-?library|z-?lib|1lib)\b[^()]*)\)?/giu, ' ')
    .replace(/\s*\(\d{1,2}\)/gu, ' ')
    .replace(/(?:[\s-]+\d{1,2})?(?:[\s-]+\d{6}){2}\s*$/u, '')
    // a date and a number after it ("_240228_5201", "_240228_200"): what a scanner or a converter adds
    .replace(/[\s-]+\d{6}[\s-]+\d{1,6}\s*$/u, '')
    // who uploaded or typed it: "נמסיס - הועלה על ידי …"
    .replace(/\s+[-–—]\s+(?:הועל(?:ה|תה)|הוקלד|נסרק|סרק|הוכן|הוקלדה)(?=\s)[\s\S]*$/u, '')
    .replace(/\s*[|•·]+\s*$/u, '')
    .replace(AUTHOR_PAIR, ' ')
  // a date (and a time) stamped on a file by a camera or a scanner, in front of the name or after it
  const STAMP = String.raw`\d{1,4}[-_.]\d{1,2}[-_.]\d{1,4}(?:[-_.\s]+\d{1,2}[-_.:]\d{2}(?:[-_.:]\d{2})?)?`
  const stamped = new RegExp(String.raw`^[-\s]*${STAMP}[-\s]+(?=\p{L})|(?<=\p{L})[-\s]+${STAMP}\s*$`, 'u')
  if (stamped.test(s)) {
    s = s.replace(stamped, '')
    // what is left was written with hyphens for spaces ("בין-אור-לחושך")
    if (!/\s/.test(s)) s = s.replace(/-+/g, ' ')
  }
  s = clean(s)
  // "קלע הכשף #5 קוטל המלכה": the number in the middle, with no dash before the title
  const hash = /^(.+?)\s+#(\d{1,3})\s+([^-–—].*)$/u.exec(s)
  if (hash) s = `${hash[1]} ${hash[2]} - ${hash[3]}`
  // an English translation of a Hebrew name, in parentheses anywhere: "סיכוי טוב למות (As Good As Dead)"
  if (/[\u0590-\u05FF]/.test(s.replace(/\([^()]*\)/g, ''))) s = clean(s.replace(/\s*\(([^()]+)\)/gu, (m, inner: string) => (latin(inner) ? ' ' : m)))
  const dash = /^(.+?)\s+[-–—]\s+(.+)$/u.exec(s)
  if (dash && latin(dash[1]!) && /[\u0590-\u05FF]/.test(dash[2]!)) s = clean(dash[2]!)
  const comma = /^(.+?\s\d{1,3}),\s+(.+)$/u.exec(s)
  if (comma) s = `${comma[1]} - ${comma[2]}`
  // the series said twice, the second time run together: "הלביאה הלוחמת - הלביאההלוחמתחלקא"
  const twice = /^(.+?)\s+[-–—]\s+(\S+)$/u.exec(s)
  if (twice) {
    const rest = unglued(twice[2]!, twice[1]!)
    if (rest !== twice[2]) s = rest ? `${twice[1]} - ${rest}` : twice[1]!
  }
  return s
}

/** a title that says nothing about the book: no word at all ("1~2402 1"), or words run together into one ("בתהמעמקיםריקריירדן") */
export function isJunkTitle(title: string): boolean {
  const words = fold(title)
    .split(' ')
    .filter((w) => /\p{L}{2}/u.test(w))
  // the word for a part or a chapter alone ("פרק", "חלק ב", "Part 6") is a heading, not the book's name
  if (new RegExp(String.raw`^(?:ה?פרק|ה?חלק|chapter|part)(?: (?:${ORDINAL_WORD}|[\u05D0-\u05EA]))?$`, 'iu').test(words.join(' '))) return true
  return !words.length || (words.length === 1 && words[0]!.length >= 14) || isGeneratedName(title)
}

/** a name no one chose: a DOS short name ("3EA41~1"), what a scanner or a converter calls its files ("CamScanner 06-06-2022
 *  16.55", "Aspose", "IMG 2041", "Gilyon-0331147165"), or letters of a broken encoding ("Ûè") */
function isGeneratedName(title: string): boolean {
  // "Microsoft Word - …": the program's name in front of the document's title
  const t = clean(title.replace(/^microsoft\s+(?:word|excel|powerpoint)\s*[-–—]\s*/iu, ''))
  if (/^[0-9a-f]{3,8}~\d{1,2}$/i.test(t)) return true
  if (/^[A-Za-z]+[-_ ]?\d{8,}$/.test(t)) return true
  // only accented Latin letters: Hebrew read as Windows-1252, never a name
  if (/[\u00C0-\u00FF]/.test(t) && !/[A-Za-z\u0590-\u05FF]/.test(t)) return true
  const rest = t
    .replace(/\b(?:camscanner|scanner|scanned|scan|img|image|photo|picture|document|doc|untitled|new|file|page|aspose|microsoft word|copy|pdf)\b/giu, ' ')
    .replace(/[\d\s._:~()\-–—]+/gu, '')
  return !rest && t !== ''
}

// lines of a title page that are not the book's name: the publisher, the credits, the copyright notice, the author's other books
const CREDIT =
  /מרגנית|הוצא(?:ת|ה)|תרגו?ם|תרגמ|מאנגלית|מצרפתית|מגרמנית|עריכ|עורכ|עיצוב|עטיפ|איור|הגהה|כל הזכויות|©|isbn|copyright|all rights|printed|published|translated|edition|מהדורה|נדפס|מודפס|דפוס|www\.|https?:|@|טל[׳']|^מאת\b|^מחבר|^מחברת|^מאותו|^ספרים נוספים|^עוד ספרים|^רב[-־ ]?המכר|^בסדרה\s*(?::|$)|^תוכן|^contents|^chapter|^פרק\b/iu

// a publisher's address or phone ("רח' אגוז 6, פארק תעשיות חמן", "ת.ד. 163, קרית גת", "משק 33, מושב בן־שמן", a postal code or
// phone number of five digits or more), a quoted line from a review on the cover ("יצירת מופת…"), or a sentence of the text
const NOT_A_NAME =
  /^(?:רח['׳']|רחוב\s|ת\.\s?ד\.?|ת["״]ד|משק\s+\d|מושב\s|קיבוץ\s|מיקוד|פקס|tel\b|fax\b)|\d{5,}|\d{2,3}-\d{6,7}|^["״“”„']|[.!]["״”']?\s*$|(?<!(?:^|[\s.])\p{L}['׳]?)[.!]\s+\S/iu

const HEBREW = /[\u05D0-\u05EA]/

const ORDINAL_WORD = String.raw`(?:ה?(?:ראשו(?:ן|נה)|שני(?:ה|יה)?|שלישי(?:ת)?|רביעי(?:ת)?|חמישי(?:ת)?|שישי(?:ת)?|שביעי(?:ת)?|שמיני(?:ת)?|תשיעי(?:ת)?|עשירי(?:ת)?)|\d{1,3})`
const BOOK_PHRASE = new RegExp(String.raw`\s*((?:ה?ספר|ה?כרך)\s+${ORDINAL_WORD})(?![\p{L}\d])\s*[-–—:,.]?\s*`, 'u')
const CREDIT_TAIL = /\s+(?:מאנגלית|מצרפתית|מגרמנית|תרגום|תרגמה|תרגם|הוצאת|עריכה|עריכת|עיצוב)(?=[\s:])[\s\S]*$/u

/** A title page whose lines the PDF conversion joined into one ("ריק ריירדן גורלו של אפולו ספר שלישי המבוך הבוער מאנגלית: …")
 *  back in its lines: split at the author's name and at "ספר שלישי", and without the credits that follow. */
function pieces(line: string, author: string): string[] {
  const a = clean(author)
  return (a ? line.split(a) : [line])
    .flatMap((p) => p.split(BOOK_PHRASE))
    .map((p) => clean(p.replace(CREDIT_TAIL, '').replace(/^(?:מאת|by)\s+/iu, '').replace(/^\s*[|•·]+|[|•·]+\s*$/gu, '')))
    .filter(Boolean)
}

const IN_SERIES = /^(?:מתוך\s+)?(?:ב|מ)?ה?סדר(?:ה|ת)\s+/u
// "בסדרת רבי־המכר המועמדת": the praise is not the series' name
const BESTSELLER = /^(?:של\s+)?(?:ה?רבי?[-־\s]?ה?מכר(?:ים)?|ה?מצליחה|ה?אהובה|ה?נודעת)\s+/u

/** "ספר שלישי", "הספר השלישי", "כרך 2", "ספר ראשון: להב הקיץ": the number, and the title when it is on the same line */
function bookLine(line: string): { number: string; title: string } | undefined {
  const m = new RegExp(String.raw`^(?:ה?ספר|ה?כרך)\s+(ה?[\p{L}]+|#?\d{1,3})(?:\s*[-–—:,.]\s*(.+))?$`, 'u').exec(line)
  const number = m && numberOf(m[1]!)
  return number ? { number, title: clean(m[2] ?? '') } : undefined
}

/**
 * Reads a book's name out of its opening lines (title page, half-title, copyright page). Its name is found when the book
 * says which one it is in its series: "גורלו של אפולו / ספר שלישי / המבוך הבוער", or the template, or "גנב הברק (פרסי
 * ג'קסון #1)" on one line. `candidates` are the short lines that may be its title, for a search when the name is not read.
 */
/** the author a title page prints by the title: the line just before it, or else just after it, when it reads as a
 *  person's name (two to four words, no digits) and is not a credit (a translator, a publisher), a series line, or
 *  part of the title itself ("הארי פוטר" above "הארי פוטר ואבן החכמים") */
export function authorFromOpening(lines: string[], title: string): string | undefined {
  const t = fold(title)
  if (!t) return undefined
  const ls = lines.slice(0, 15).map((l) => clean(l.replace(/_+/g, ' ')))
  const i = ls.findIndex((l) => fold(l) === t)
  if (i < 0) return undefined
  const person = (l?: string) =>
    !!l &&
    /^[\p{L}'׳".-]+(?:\s+[\p{L}'׳".-]+){1,3}$/u.test(l) &&
    !CREDIT.test(l) &&
    !NOT_A_NAME.test(l) &&
    !IN_SERIES.test(l) &&
    !bookLine(l) &&
    !/^(?:ה?ספר|כרך|book|vol)\b/iu.test(l) &&
    !t.includes(fold(l))
  return [ls[i - 1], ls[i + 1]].find(person)
}

/**
 * The author a cover prints, when the book's name has none: among the cover's lines, the ones that are a person's name
 * (not a credit, a series, a number or part of the title). An author the library has wins; otherwise the one such line, or
 * nothing when there are several (the translator's name, the illustrator's) and no way to tell them apart.
 */
export function authorFromCover(lines: string[], title: string, known: readonly string[] = []): string | undefined {
  const t = fold(title)
  const names = [
    ...new Set(
      lines
        .slice(0, 12)
        .map((l) => clean(l.replace(/_+/g, ' ').replace(/^(?:מאת|by)\s*[:：]?\s*/iu, '')))
        .filter(
          (l) =>
            personShaped(l) && !CREDIT.test(l) && !NOT_A_NAME.test(l) && !IN_SERIES.test(l) && !bookLine(l) && !(t && (t.includes(fold(l)) || fold(l).includes(t))),
        ),
    ),
  ]
  const have = names.map((n) => known.find((k) => people(k) === people(n))).find(Boolean)
  return have ?? (names.length === 1 ? names[0] : undefined)
}

export function nameFromOpening(lines: string[], author: string): { name?: BookName; candidates: string[] } {
  const a = fold(author)
  const kept = lines
    .flatMap((l) => pieces(clean(l.replace(/_+/g, ' ')), author))
    .filter((l) => l && l.length <= 70 && /\p{L}{2}/u.test(l) && !CREDIT.test(l) && !NOT_A_NAME.test(l))
    .filter((l) => !a || (fold(l) !== a && !fold(l).includes(a)))
  const short = (l: string) => l.length <= 45 && l.split(' ').length <= 8 && !bookLine(l)

  let name: BookName | undefined
  for (let i = 0; i < kept.length && !name; i++) {
    // "ממלכה של בשר ואש / ספר שני בסדרה הדם והאפר": the book's number and its series on one line, the title before it
    const whole = /^(?:ספר|כרך|book)\s.*\s(?:ב?סדרת|בסדרה|of the|in the)\s/iu.test(kept[i]!) ? seriesOf(kept[i]!) : undefined
    const before = whole && [...kept.slice(Math.max(0, i - 2), i)].reverse().find(short)
    if (whole && before && fold(before) !== fold(whole.series)) {
      name = { number: whole.number, series: clean(whole.series.replace(BESTSELLER, '').replace(/^["״“”„']+|["״“”„']+$/gu, '')), title: before }
      break
    }
    const b = bookLine(kept[i]!)
    if (!b) continue
    // "הסירנה / הספר הראשון / בסדרת החוטאים המקוריים": the series comes after, and the title before
    const inSeries = !b.title && kept[i + 1] ? IN_SERIES.exec(kept[i + 1]!) : null
    if (inSeries) {
      const title = [...kept.slice(Math.max(0, i - 2), i)].reverse().find(short)
      const series = clean(
        kept[i + 1]!
          .slice(inSeries[0].length)
          .replace(BESTSELLER, '')
          .replace(/^["״“”„']+|["״“”„']+$/gu, ''),
      )
      if (title && series) name = { series, number: b.number, title }
      continue
    }
    const series = [...kept.slice(Math.max(0, i - 3), i)].reverse().find((l) => short(l) && HEBREW.test(l) === HEBREW.test(kept[i]!))
    const title = b.title || kept.slice(i + 1, i + 3).find(short) || ''
    if (series && title && fold(series) !== fold(title)) name = { series: clean(series.replace(/^(?:מתוך )?(?:ה?סדר(?:ה|ת))\s+/u, '')), number: b.number, title }
  }
  if (!name) {
    // a whole name on one line, Hebrew before English
    const named = kept
      .filter((l) => l.length <= 70)
      .map((l) => guessBookName(tidyBookName(l)))
      .filter((n) => n.series && n.title)
    name = named.find((n) => HEBREW.test(n.title)) ?? named[0]
  }
  const seen = new Set<string>()
  const candidates = kept
    .filter(short)
    .filter((l) => l.length >= 3 && !seen.has(fold(l)) && seen.add(fold(l)))
    .sort((x, y) => Number(HEBREW.test(y)) - Number(HEBREW.test(x)))
    .slice(0, 6)
  return { name, candidates }
}
