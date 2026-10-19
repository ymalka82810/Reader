// The library's naming template for a book: "series number - title", e.g. "פרסי ג'קסון 1 - גנב הברק". The number may carry
// words of its own ("הערפילאים 2 העידן הראשון - האימפריה האחרונה"), and the title may hold dashes of its own
// ("שיר של אש ושל קרח 3 - סופת החרבות, חלק ראשון - פלדה ושלג"). A book outside a series is named by its title alone.

export interface BookName {
  series: string
  /** the book's place in the series: "1", or with words that follow it, "2 העידן הראשון" */
  number: string
  title: string
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** the name in the template */
export function formatBookName({ series, number, title }: BookName): string {
  const s = clean(series)
  const n = clean(number)
  const name = clean(title)
  if (!s) return name
  const head = n ? `${s} ${n}` : s
  return name ? `${head} - ${name}` : head
}

// a series number has up to three digits, so a year in a title ("1984", "מלחמת 1948") is not taken for one
const TEMPLATE = /^(.+?)\s+(\d{1,3}(?:\s+[^\s\-–—][^\-–—]*?)?)\s+[-–—]\s+(.+)$/u

/** A name already in the template, split into its parts; any other name is all title. formatBookName undoes it. */
export function splitBookName(name: string): BookName {
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
]

/** "3", "03", "#3", "שלישי" or "third" as "3"; undefined for anything else */
function numberOf(word: string): string | undefined {
  const w = word.replace(/^#/, '')
  if (/^\d{1,3}$/.test(w)) return String(Number(w))
  return ORDINALS.find(([re]) => re.test(w))?.[1]
}

const NUM = String.raw`(#?\d{1,3}|[\p{L}]+)`
const DASH = String.raw`[-–—:,.]`
// "חלק" is left out on purpose: it is part of many titles ("סופת החרבות, חלק ראשון")
const BOOK_WORD = String.raw`(?:ספר|כרך|book|vol\.?|volume)`

/** "פרסי ג'קסון, ספר 1", "פרסי ג'קסון #1", "Mistborn 1", "ספר ראשון בסדרת פרסי ג'קסון", "Book 1 of Mistborn":
 *  a series and the book's number in it */
export function seriesOf(text: string): { series: string; number: string } | undefined {
  const s = clean(text)
  const tries: [RegExp, number, number][] = [
    [new RegExp(String.raw`^${BOOK_WORD}\s+${NUM}\s+(?:ב?סדרת|בסדרה|מתוך|of(?: the)?|in(?: the)?)\s+(.+)$`, 'iu'), 2, 1],
    [new RegExp(String.raw`^(.+?)(?:\s*${DASH}\s*|\s+)${BOOK_WORD}\s+${NUM}$`, 'iu'), 1, 2],
    [new RegExp(String.raw`^(.+?)\s*,?\s+(#?\d{1,3})$`, 'u'), 1, 2],
  ]
  for (const [re, si, ni] of tries) {
    const m = re.exec(s)
    const number = m && numberOf(m[ni]!)
    const series = m && clean(m[si]!.replace(/\s*[-–—:,]\s*$/, ''))
    if (number && series) return { series, number }
  }
  return undefined
}

/**
 * Reads a series, number and title out of a free-form name: a file name, a book's own metadata or a catalog entry.
 * Understands the template itself and the common variants: "גנב הברק (פרסי ג'קסון #1)", "פרסי ג'קסון ספר 1: גנב הברק",
 * "פרסי ג'קסון - ספר ראשון - גנב הברק", "Mistborn 1: The Final Empire", with "_" for spaces. What it cannot read is the title.
 */
export function guessBookName(text: string): BookName {
  const s = clean(text.replace(/_+/g, ' '))
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
    if (number && series) return { series, number, title: clean(word[3]!) }
  }

  // the template, also with "#1" or ":" ("Mistborn #1: The Final Empire")
  const tpl = /^(.+?)\s+#?(\d{1,3}(?:\s+[^\s\-–—:][^\-–—:]*?)?)\s*(?:\s[-–—]|:)\s+(.+)$/u.exec(s)
  if (tpl) {
    const [num, ...rest] = tpl[2]!.split(' ')
    return { series: clean(tpl[1]!), number: [numberOf(num!) ?? num, ...rest].join(' '), title: clean(tpl[3]!) }
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
export function withoutAuthor(name: string, author: string): string {
  const a = fold(author)
  if (!a) return name
  const parts = name.split(/\s+[-–—]\s+/)
  if (parts.length < 2) return name
  if (fold(parts[parts.length - 1]!) === a) return parts.slice(0, -1).join(' - ')
  if (fold(parts[0]!) === a) return parts.slice(1).join(' - ')
  return name
}
