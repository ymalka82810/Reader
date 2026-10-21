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

/** "3", "03", "#3", "שלישי" or "third" as "3"; undefined for anything else */
function numberOf(word: string): string | undefined {
  const w = word.replace(/^#/, '')
  if (/^\d{1,3}$/.test(w)) return String(Number(w))
  // "השלישי" is "שלישי" with the article
  const bare = /^ה[\u05D0-\u05EA]{3,}$/u.test(w) ? w.slice(1) : w
  return ORDINALS.find(([re]) => re.test(w) || re.test(bare))?.[1]
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
/** a name of people folded for comparing: "הולי בלק & קסנדרה קלייר" is "הולי בלק וקסנדרה קלייר" ("and" is "ו") */
const people = (s: string) => fold(s.replace(/\s+(?:&|and)\s+/giu, ' ו')).replace(/(^| )ו(?=\p{L}{2})/gu, '$1')

export function withoutAuthor(name: string, author: string): string {
  const a = people(author)
  if (!a) return name
  // in parentheses: "המלך דוד (שרון חיון גינת)"
  name = clean(name.replace(/\s*\(([^()]+)\)/gu, (m, inner: string) => (people(inner) === a ? ' ' : m)))
  const parts = name.split(/\s+[-–—]\s+/)
  if (parts.length >= 2) {
    if (people(parts[parts.length - 1]!) === a) return parts.slice(0, -1).join(' - ')
    if (people(parts[0]!) === a) return parts.slice(1).join(' - ')
  }
  // the author's name run on at the end with no dash, as in a file name with underscores ("קוטל_המלכה_סבסטיאן_דה_קסטל")
  const words = clean(name).split(' ')
  for (let k = 1; k < words.length; k++) if (people(words.slice(-k).join(' ')) === a) return words.slice(0, -k).join(' ')
  return name
}

const latin = (s: string) => /[A-Za-z]/.test(s) && !/[\u0590-\u05FF]/.test(s)

/**
 * Cleans what file names and PDF metadata add around a book's name, before it is read: Drive's "עותק של" / "Copy of",
 * a trailing "(1)", an English translation in parentheses after a Hebrew name, an English name before a Hebrew one
 * ("The Trials of Apollo 4 - גורלו של אפולו 4, ..."), and the comma between the number and the title
 * ("גורלו של אפולו 1, האורקל הנסתר" -> "גורלו של אפולו 1 - האורקל הנסתר").
 */
const annasParts = (s: string) => {
  const parts = s.split(/\s*--\s*/).map(clean)
  return parts.length >= 3 && /^anna['’]?s archive$/i.test(parts[parts.length - 1]!) ? parts : undefined
}

/** "title -- author -- series, n -- year -- publisher -- md5 -- Anna’s Archive" as the template ("series n - title") */
function annasArchive(s: string): string | undefined {
  const parts = annasParts(s)
  if (!parts) return undefined
  const title = parts[0]!
  for (const p of parts.slice(2, -1)) {
    if (!/\p{L}{2}/u.test(p) || /^[\da-f]{32}$/i.test(p)) continue // the year, the md5
    const m = /^(.+?)[\s,،#:.]+(?:(?:כרך|ספר|book|vol\.?)\s*)?#?(\d{1,3})$/iu.exec(p) ?? /^#?(\d{1,3})[\s,،:.]+(.+)$/u.exec(p)
    if (!m) continue
    const [series, n] = /^\d/.test(m[1]!) ? [m[2]!, m[1]!] : [m[1]!, m[2]!]
    return `${clean(series)} ${Number(n)} - ${title}`
  }
  return title
}

/** the author an Anna's Archive name carries (its second part); '' for any other name */
export function authorInName(s: string): string {
  const a = annasParts(clean(s.replace(/_+/g, ' ')))?.[1] ?? ''
  return /\p{L}{2}/u.test(a) ? a : ''
}

export function tidyBookName(text: string): string {
  let s = clean(text.replace(/_+/g, ' '))
  s = annasArchive(s) ?? s
  s = s
    .replace(/^(?:(?:עותק של|copy of)\s+)+/iu, '') // also "עותק של עותק של"
    .replace(/\.(?:md|txt|epub|pdf|docx?|fb2|mobi|azw3?)$/iu, '')
    // what a download site adds: "(Z-Library)", "(z-library.sk, 1lib.sk, z-lib.sk)", and a date and time stamp
    .replace(/\s*\((?:[^()]*\b(?:z-?library|z-?lib|1lib)\b[^()]*)\)?/giu, ' ')
    .replace(/\s*\(\d{1,2}\)/gu, ' ')
    .replace(/(?:[\s-]+\d{1,2})?(?:[\s-]+\d{6}){2}\s*$/u, '')
    // who uploaded or typed it: "נמסיס - הועלה על ידי …"
    .replace(/\s+[-–—]\s+(?:הועל(?:ה|תה)|הוקלד|נסרק|סרק|הוכן|הוקלדה)(?=\s)[\s\S]*$/u, '')
    .replace(/\s*[|•·]+\s*$/u, '')
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
  return s
}

/** a title that says nothing about the book: no word at all ("1~2402 1"), or words run together into one ("בתהמעמקיםריקריירדן") */
export function isJunkTitle(title: string): boolean {
  const words = fold(title)
    .split(' ')
    .filter((w) => /\p{L}{2}/u.test(w))
  return !words.length || (words.length === 1 && words[0]!.length >= 14)
}

// lines of a title page that are not the book's name: the publisher, the credits, the copyright notice, the author's other books
const CREDIT =
  /מרגנית|הוצא(?:ת|ה)|תרגו?ם|תרגמ|מאנגלית|מצרפתית|מגרמנית|עריכ|עורכ|עיצוב|עטיפ|איור|הגהה|כל הזכויות|©|isbn|copyright|all rights|printed|published|translated|edition|מהדורה|נדפס|מודפס|דפוס|www\.|https?:|@|טל[׳']|^מאת\b|^מחבר|^מחברת|^מאותו|^ספרים נוספים|^עוד ספרים|^רב[-־ ]?המכר|^בסדרה|^תוכן|^contents|^chapter|^פרק\b/iu

// a publisher's address or phone ("רח' אגוז 6, פארק תעשיות חמן", "ת.ד. 163, קרית גת", "משק 33, מושב בן־שמן", a postal code or
// phone number of five digits or more), a quoted line from a review on the cover ("יצירת מופת…"), or a sentence of the text
const NOT_A_NAME =
  /^(?:רח['׳']|רחוב\s|ת\.\s?ד\.?|ת["״]ד|משק\s+\d|מושב\s|קיבוץ\s|מיקוד|פקס|tel\b|fax\b)|\d{5,}|\d{2,3}-\d{6,7}|^["״“”„']|[.!]["״”']?\s*$|[.!]\s+\S/iu

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
export function nameFromOpening(lines: string[], author: string): { name?: BookName; candidates: string[] } {
  const a = fold(author)
  const kept = lines
    .flatMap((l) => pieces(clean(l.replace(/_+/g, ' ')), author))
    .filter((l) => l && l.length <= 70 && /\p{L}{2}/u.test(l) && !CREDIT.test(l) && !NOT_A_NAME.test(l))
    .filter((l) => !a || (fold(l) !== a && !fold(l).includes(a)))
  const short = (l: string) => l.length <= 45 && l.split(' ').length <= 8 && !bookLine(l)

  let name: BookName | undefined
  for (let i = 0; i < kept.length && !name; i++) {
    const b = bookLine(kept[i]!)
    if (!b) continue
    // "הסירנה / הספר הראשון / בסדרת החוטאים המקוריים": the series comes after, and the title before
    const inSeries = !b.title && kept[i + 1] ? IN_SERIES.exec(kept[i + 1]!) : null
    if (inSeries) {
      const title = [...kept.slice(Math.max(0, i - 2), i)].reverse().find(short)
      const series = clean(kept[i + 1]!.slice(inSeries[0].length).replace(/^["״“”„']+|["״“”„']+$/gu, ''))
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
