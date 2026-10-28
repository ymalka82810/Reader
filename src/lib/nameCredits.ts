// What a found name carries that is not the book's name: the author said once more inside the series or the title ("ל א
// קוטון לייקשור יו 1", "בני הנפילים 1 עיר של עצמות ק קלייר"), the publisher and the year ("2023 הוצאת טורקיז 9"), the
// series said again at the head of the title ("שומרת הערים האבודות - שומרת הערים האבודות גלות"), and the title run on to
// the author ("סיאל יפהפייה פראית" by the book "יפהפייה פראית"). The author is matched in any spelling the names use:
// with or without dots and quotes ("ל. א. קוטון", "ל א קוטון"), and with a first name cut to its first letter ("י מלכה",
// "י' מלכה" for "יוחאי מלכה").

import { formatBookName, splitBookName, type BookName } from './bookName'

/** a word as it is compared: no points, no quotes, lower case */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()

/** the words of a text, each with the parts it is made of when dots join them ("סי.סי." is "סי" and "סי") */
function unitsOf(words: string[]): { unit: string; word: number }[] {
  const out: { unit: string; word: number }[] = []
  words.forEach((w, i) => {
    for (const part of w.split(/[.·]+/u)) {
      const u = fold(part)
      if (u) out.push({ unit: u, word: i })
    }
  })
  return out
}

/** the author's names: one per author, in their parts ("ל. א. קוטון" is "ל", "א", "קוטון") */
function authorsOf(author: string): string[][] {
  return author
    .split(/\s*[,;&]\s*|\s+(?:and)\s+|\s+ו(?=\p{L}{2,}\s)/iu)
    .map((a) => a.split(/[\s.·]+/u).map(fold).filter(Boolean))
    .filter((a) => a.length >= 2 || (a.length === 1 && a[0]!.length >= 3))
}

/** one of the author's words and one of the text's: the same word, or one of them the other's first letter */
function sameWord(a: string, t: string, last: boolean): boolean {
  if (a === t) return true
  // the last name is said in full; a first or middle name may be its first letter alone
  if (last) return false
  return (a.length === 1 && t.length > 1 && t.startsWith(a)) || (t.length === 1 && a.length > 1 && a.startsWith(t))
}

/** the words of the text the author's name takes, [from, to) in words, or undefined */
function findAuthor(words: string[], author: string[]): [number, number] | undefined {
  const units = unitsOf(words)
  const n = author.length
  for (let i = 0; i + n <= units.length; i++) {
    // the name starts and ends on whole words of the text
    if (i > 0 && units[i - 1]!.word === units[i]!.word) continue
    let ok = true
    for (let k = 0; k < n && ok; k++) ok = sameWord(author[k]!, units[i + k]!.unit, k === n - 1)
    if (!ok) continue
    const end = i + n - 1
    if (end + 1 < units.length && units[end + 1]!.word === units[end]!.word) continue
    // a name of one word must be long enough not to be any word of a title
    if (n === 1 && author[0]!.length < 3) continue
    return [units[i]!.word, units[end]!.word + 1]
  }
  return undefined
}

// marks and joining words left at the edges once a name is taken out
const EDGE = /^(?:[-–—:,·|/]+|מאת|by)$/iu

function trimEdges(words: string[]): string[] {
  let a = 0
  let b = words.length
  while (a < b && EDGE.test(words[a]!)) a++
  while (b > a && EDGE.test(words[b - 1]!)) b--
  return words.slice(a, b)
}

/** the text without the author's name wherever it stands; the text as it was when nothing else would be left */
export function withoutAuthorAnywhere(text: string, author: string): string {
  let words = text.trim().split(/\s+/u).filter(Boolean)
  if (!words.length) return text
  for (const a of authorsOf(author)) {
    for (let guard = 0; guard < 3; guard++) {
      const at = findAuthor(words, a)
      if (!at) break
      // "מאת" right before the name goes with it
      const from = at[0] > 0 && /^מאת$/u.test(words[at[0] - 1]!) ? at[0] - 1 : at[0]
      const rest = trimEdges([...words.slice(0, from), ...words.slice(at[1])])
      if (!rest.some((w) => fold(w))) return text
      words = rest
    }
  }
  return words.join(' ')
}

// a publisher's own words, so a name of two words ("כנרת זמורה", "ידיעות ספרים") is taken whole
const PUBLISHER_WORDS = new Set(
  'כנרת זמורה ביתן זמורה-ביתן דביר מודן ידיעות אחרונות ספרים ספרי חמד עם עובד כתר אריה ניר מטר יהלומים סטימצקי שוקן תכלת אופוס פן חרגול מעריב שלגי נובה הקיבוץ המאוחד טורקיז אחוזת בית אגם בבל אור עליית הגג סלע מאיר בוקסילון אסיה לאור בע"מ בעמ'
    .split(/\s+/u)
    .map(fold),
)
const YEAR = /^[([]?(?:19|20)\d{2}[)\]]?[.,]?$/u
const PUBLISHER = /^(?:ב|ו)?הוצא(?:ת|ה|ות)$/u

/** the text without the publisher ("הוצאת טורקיז", "בהוצאת כנרת זמורה") and the year printed with it */
export function withoutPublisher(text: string, isSeries: boolean): string {
  let words = text.trim().split(/\s+/u).filter(Boolean)
  let took = false
  for (let i = 0; i < words.length; i++) {
    if (!PUBLISHER.test(words[i]!) && !/^publish(?:ing|ers?)$|^press$/iu.test(words[i]!)) continue
    let from = i
    let to = i + 1
    if (PUBLISHER.test(words[i]!)) {
      // "הוצאה לאור", "הוצאת של": then the publisher's name, and its further words when they are a publisher's
      while (to < words.length && /^(?:לאור|של|ספרים)$/u.test(words[to]!)) to++
      if (to < words.length) to++
      while (to < words.length && PUBLISHER_WORDS.has(fold(words[to]!))) to++
    } else if (from > 0) from-- // "Turquoise Publishing": the name before it
    if (from > 0 && YEAR.test(words[from - 1]!)) from--
    if (to < words.length && YEAR.test(words[to]!)) to++
    const rest = trimEdges([...words.slice(0, from), ...words.slice(to)])
    // a series that is only the publisher is none; a title keeps its words
    if (!rest.length) return isSeries ? '' : text
    words = rest
    took = true
    i = from - 1
  }
  // a year at the edge of a series is never its name; in a title only when it came with the publisher, or in brackets
  const drop = (w: string) => YEAR.test(w) && (isSeries || took || /^[([]/u.test(w))
  while (words.length > 1 && drop(words[0]!)) words = trimEdges(words.slice(1))
  while (words.length > 1 && drop(words[words.length - 1]!)) words = trimEdges(words.slice(0, -1))
  return words.join(' ')
}

/** a title that opens with the whole series (of two words at least) and goes on, without it */
function withoutSeriesHead(title: string, series: string): string {
  const s = series.trim().split(/\s+/u).map(fold).filter(Boolean)
  const words = title.trim().split(/\s+/u)
  if (s.length < 2 || words.length <= s.length) return title
  for (let k = 0; k < s.length; k++) if (fold(words[k]!) !== s[k]) return title
  const rest = trimEdges(words.slice(s.length))
  return rest.some((w) => fold(w)) ? rest.join(' ') : title
}

/** an author that carries the book's title (or its series) after or before the name, without it */
function authorWithoutTitle(author: string, ...names: string[]): string {
  const words = author.trim().split(/\s+/u)
  for (const name of names) {
    const n = name.trim().split(/\s+/u).map(fold).filter(Boolean)
    if (!n.length || words.length <= n.length) continue
    const tail = words.slice(-n.length).map(fold)
    if (tail.every((w, k) => w === n[k])) return trimEdges(words.slice(0, -n.length)).join(' ') || author
    const head = words.slice(0, n.length).map(fold)
    if (head.every((w, k) => w === n[k])) return trimEdges(words.slice(n.length)).join(' ') || author
  }
  return author
}

/**
 * The name without what is not the book's: the author (as `authors` give it: the name found, and the one the file had)
 * taken out of the series and the title, the publisher and its year, the series said again at the head of the title,
 * and the title out of the author.
 */
export function withoutCredits<T extends BookName & { author?: string }>(r: T, ...authors: (string | undefined)[]): T {
  let series = r.series
  let title = r.title
  let author = (r.author ?? '').trim()
  if (author) author = authorWithoutTitle(author, title, series)
  for (const a of [author, ...authors]) {
    if (!a?.trim()) continue
    if (series) series = withoutAuthorAnywhere(series, a)
    if (title) title = withoutAuthorAnywhere(title, a)
  }
  if (series) series = withoutPublisher(series, true)
  if (title) title = withoutPublisher(title, false)
  // a series that was nothing but the publisher and the year is no series, and its number goes with it
  let number = r.number
  if (r.series && !/\p{L}/u.test(series)) {
    series = ''
    number = ''
  }
  if (series && title) title = withoutSeriesHead(title, series)
  if (series === r.series && title === r.title && number === r.number && author === (r.author ?? '').trim()) return r
  return { ...r, series, number, title, ...(r.author !== undefined ? { author } : {}) }
}

/** a name already in the template (as the waiting list keeps it), cleaned the same way */
export function nameWithoutCredits(name: string, author: string): { title: string; author: string } {
  const r = withoutCredits({ ...splitBookName(name), author }, author)
  return { title: formatBookName(r) || name, author: r.author ?? author }
}
