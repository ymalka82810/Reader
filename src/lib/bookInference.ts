// Inference from what a reader would notice in a translated book: its copyright page names the original edition, and
// often the original series with the book's number in it ("THE GOLDEN TOWER" / "MAGISTERIUM V"). The original series is
// matched to a series the library already has in Hebrew by how the names sound ("MAGISTERIUM" is "מגיסטריום"), so the
// book is "מגיסטריום 5" even when its file name and its cover say nothing readable.

/** the consonants of a name as they sound, the same for Latin and Hebrew letters: "magisterium" and "מגיסטריום" are
 *  both "mgstrm", "Percy Jackson" and "פרסי ג'קסון" both "prsgksn". Vowels and the letters that stand for them are
 *  left out. */
export function soundOf(name: string): string {
  const s = name.toLowerCase()
  let out = ''
  if (/[\u05D0-\u05EA]/u.test(s)) {
    const HE: Record<string, string> = {
      ב: 'b', ג: 'g', ד: 'd', ז: 'z', ט: 't', ת: 't', כ: 'k', ך: 'k', ק: 'k', ל: 'l', מ: 'm', ם: 'm', נ: 'n', ן: 'n',
      ס: 's', ש: 's', פ: 'p', ף: 'p', צ: 's', ץ: 's', ר: 'r',
    }
    for (const ch of s) out += HE[ch] ?? ''
  } else {
    const t = s
      .replace(/[^a-z]/g, '')
      .replace(/ph/g, 'f')
      .replace(/ck/g, 'k')
      .replace(/c(?=[eiy])/g, 's')
      // "tch" is written צ' ("Pratchett", "פראצט")
      .replace(/tch/g, 's')
      .replace(/(?:sh|ch|th|tz|ts)/g, (m) => ({ sh: 's', ch: 'k', th: 't', tz: 's', ts: 's' })[m]!)
    const LA: Record<string, string> = {
      b: 'b', v: 'b', c: 'k', d: 'd', f: 'p', g: 'g', j: 'g', k: 'k', q: 'k', l: 'l', m: 'm', n: 'n', p: 'p', r: 'r',
      s: 's', t: 't', x: 'ks', z: 'z',
    }
    for (const ch of t) out += LA[ch] ?? ''
  }
  return out.replace(/(.)\1+/g, '$1')
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50 }
/** "V" is 5, "XII" is 12, "7" is 7; undefined for anything else, or a number past 60 */
export function bookNumber(s: string): number | undefined {
  if (/^\d{1,2}$/.test(s)) return Number(s) || undefined
  const r = s.toLowerCase()
  if (!/^[ivxl]{1,6}$/.test(r)) return undefined
  let n = 0
  for (let i = 0; i < r.length; i++) {
    const v = ROMAN[r[i]!]!
    const next = ROMAN[r[i + 1] ?? ''] ?? 0
    n += v < next ? -v : v
  }
  return n > 0 && n <= 60 ? n : undefined
}

// lines of a copyright page that are not the original's series line
const NOT_SERIES = /copyright|©|rights|isbn|published|publishing|press|ltd|inc\b|translat|illustrat|edition|www\.|https?:|\d{4}/i
// "MAGISTERIUM V", "Magisterium, Book 5", "THE HUNGER GAMES #2", "Throne of Glass vol. 3"
const SERIES_LINE = /^([A-Za-z][A-Za-z'’&.\- ]{2,50}?)[\s,:#\-–—]+(?:(?:book|vol(?:ume)?|no|part)\.?\s*#?)?([IVXLivxl]{1,6}|\d{1,2})$/i

const bare = (s: string) => s.replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim()
const latinOnly = (s: string) => !!s && !/[\u0590-\u05FF]/u.test(s) && !NOT_SERIES.test(s) && s.split(/\s+/).length <= 8
// the authors' line over the title ("Holly Black and Cassandra Clare", "by Rick Riordan")
const BYLINE = /^by\s|\s(?:and|&)\s/i

/** The original series and the book's number in it, as a copyright page in Latin letters names them, with the original
 *  title when the line over the series is one ("THE GOLDEN TOWER" over "MAGISTERIUM V"). */
export function originalSeries(opening: string[]): { series: string; number: string; title?: string } | undefined {
  for (let i = 0; i < opening.length; i++) {
    const line = bare(opening[i]!)
    if (!latinOnly(line) || line.split(/\s+/).length > 7) continue
    const m = SERIES_LINE.exec(line)
    if (!m) continue
    const n = bookNumber(m[2]!)
    const series = m[1]!.replace(/[\s,:#\-–—]+$/u, '').trim()
    if (!n || soundOf(series).length < 4) continue
    const above = bare(opening[i - 1] ?? '')
    const title = latinOnly(above) && !BYLINE.test(above) && /[A-Za-z]{3}/.test(above) && !SERIES_LINE.test(above) ? above : undefined
    return { series, number: String(n), ...(title && { title }) }
  }
  return undefined
}

/** "THE GOLDEN TOWER" as "The Golden Tower", which a translation service reads as a name */
export function titleCase(s: string): string {
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase()) : s
}

/** The library's series this original series is, by how both sound, of the same author when the book has one; the
 *  library's name for it, or undefined when none or more than one fits. */
export function librarySeriesFor(
  original: string,
  author: string,
  series: Iterable<{ name: string; authors: Set<string> }>,
  norm: (s: string) => string,
): string | undefined {
  const sound = soundOf(original.replace(/^the\s+/i, ''))
  const a = norm(author)
  const fits = [...series].filter(
    (s) => soundOf(s.name) === sound && (!a || !s.authors.size || [...s.authors].some((x) => x === a || x.includes(a) || a.includes(x))),
  )
  const names = new Set(fits.map((s) => s.name))
  return names.size === 1 ? [...names][0] : undefined
}

/** The year the book was first published, as its copyright page says it: the original's year for a translation
 *  ("Copyright © 2018 by …"), not the Hebrew edition's ("Hebrew Language Copyright © 2019"). */
export function copyrightYear(opening: string[]): number | undefined {
  const lines = opening.map(bare).filter((l) => /copyright|©/i.test(l))
  const original = lines.filter((l) => !/hebrew|[\u0590-\u05FF]/iu.test(l))
  for (const l of [...original, ...lines]) {
    const y = /\b(1[89]\d\d|20\d\d)\b/.exec(l)
    if (y) return Number(y[1])
  }
  return undefined
}

/** A line that is a series of the library's with no number: the original's on the copyright page ("MAGISTERIUM", by how
 *  it sounds) or the Hebrew name itself (a half-title, a running head). Undefined when none or more than one fits. */
export function originalSeriesName(
  opening: string[],
  author: string,
  series: Iterable<{ name: string; authors: Set<string> }>,
  norm: (s: string) => string,
): string | undefined {
  const all = [...series]
  for (const raw of opening) {
    const line = bare(raw)
    if (!line || line.split(/\s+/).length > 4 || BYLINE.test(line) || soundOf(line).length < 4) continue
    if (/[\u0590-\u05FF]/u.test(line)) {
      // a Hebrew line (a half-title, a running head) is the series only when it is its very name
      const same = all.filter((x) => norm(x.name) === norm(line) && librarySeriesFor(line, author, [x], norm))
      if (same.length === 1) return same[0]!.name
      continue
    }
    if (!latinOnly(line)) continue
    const name = librarySeriesFor(line, author, all, norm)
    if (name) return name
  }
  return undefined
}

/** The number a book of a series has, from the numbers the library already has in it and the years its books were first
 *  published: of the numbers missing (2 or 5 after 1, 3 and 4), the one the years agree with — a book first published
 *  after the others comes after them. Undefined without the book's year, or when the years do not decide it. */
export function numberByGaps(members: { number: number; year?: number }[], year?: number): number | undefined {
  if (!members.length) return undefined
  // books of the series the library has with no number at all ("פרויקט X - הבן האובד"): the order of their years is the
  // order of the series, when every one of them has a year and none shares this book's
  if (!year) return undefined
  // when every book of the series the library has, numbered or not, has a year, and none shares this book's: its place
  // among them by year, if the numbered ones are at their own places too (no book of the series missing before them)
  if (members.every((m) => m.year !== undefined && m.year !== year)) {
    const place = 1 + members.filter((m) => m.year! < year).length
    const at = (m: { year?: number }) => 1 + members.filter((o) => o.year! < m.year!).length + (m.year! > year ? 1 : 0)
    if (members.every((m) => !m.number || m.number === at(m))) return place
  }
  // unnumbered books whose order is unknown leave the numbers open
  if (members.some((m) => !m.number)) return undefined
  const have = new Set(members.map((m) => m.number))
  const max = Math.max(...have)
  const gaps: number[] = []
  for (let i = 1; i <= max + 1; i++) if (!have.has(i)) gaps.push(i)
  // without the book's year it is only a guess (2 or 4 after 1 and 3; and a book the library lacks may come before the
  // next one): no number then
  if (!year) return undefined
  const fits = gaps.filter((g) => members.every((m) => m.year === undefined || (m.number < g ? m.year <= year : m.year >= year)))
  // years that decide need a year on the other side of the gap: "after 4" with no year past it is still only a guess
  const dated = members.filter((m) => m.year !== undefined)
  const sure = (g: number) => !year || g < max || dated.some((m) => m.number < g)
  return fits.length === 1 && sure(fits[0]!) ? fits[0] : undefined
}

// Common Hebrew words that every story has, so two books sharing them says nothing about a series. The names a series
// shares (its characters, its places: "קאל", "אלסטייר", "מגיסטריום") are what is left.
const COMMON = new Set(
  `אני אתה את הוא היא אנחנו אתם הם הן אותו אותה אותם אותי אותך אותנו לו לה לי לך לנו להם להן שלו שלה שלי שלך שלנו שלהם
  שלהן זה זאת זו אלה אלו כל כולם כולן הכול הכל היה היתה הייתה היו יהיה תהיה יהיו להיות הייתי היית אבל גם רק עוד כבר
  לא לו אם כי כמו אז עכשיו פעם שוב אחר אחרי אחרת אחד אחת שני שתי שלוש מה מי איך למה מתי איפה היכן כאן שם פה הנה
  אמר אמרה אמרו אומר אומרת שאל שאלה ענה ענתה חשב חשבה ידע ידעה יודע יודעת רצה רצתה רוצה ראה ראתה רואה הלך הלכה
  בא באה הגיע הגיעה עשה עשתה עושה נתן נתנה לקח לקחה יכול יכולה יכל יכלה צריך צריכה אולי באמת בדיוק ממש מאוד יותר
  פחות הרבה קצת מעט לפני מול בין תוך בתוך מתוך עם על אל מן עד בלי ללא כדי בגלל למרות אצל ליד אחורה קדימה למעלה
  למטה החוצה פנימה שלא שהוא שהיא שהם שזה שאני שאתה כשהוא כשהיא כשהם עליו עליה עליהם אליו אליה אליהם ממנו ממנה
  איתו איתה איתם איתי בו בה בהם בי בך בשביל יום ימים לילה בוקר ערב שנה שנים זמן רגע דבר דברים משהו מישהו שום
  כלום אדם אנשים איש אישה ילד ילדה ילדים בית הבית עיניו עיניה פניו פניה ידו ידה ידיו ידיה ראשו ראשה לבו ליבו
  קול מבט נראה נראתה הרגיש הרגישה התחיל התחילה המשיך המשיכה עמד עמדה ישב ישבה קם קמה לחש לחשה צעק צעקה חייך
  חייכה הביט הביטה הסתכל הסתכלה הנהן הנהנה טוב טובה רע רעה גדול גדולה קטן קטנה חדש חדשה ישן ישנה ראשון אחרון
  ביותר עדיין תמיד אף אפילו לגמרי כמעט בסדר כן נכון כך ככה כאילו אולם ואולם אלא אבא אמא ספר פרק עמוד שאלתי
  לעצמו לעצמה עצמו עצמה זמורה כנרת דביר מוציאים לאור הוצאת הוצאה זכויות שמורות חדר ראש מקום עבר לעשות חשוב פשוט
  אחרים כול אילו לכם להם פני פנים דרך קרה ניסה ניסתה הצליח הצליחה נשמע נשמעה להגיד לומר חושב חושבת בטוח בטוחה
  עיניים ידיים רגל רגליים אביו אמו אביה אמה הורים שולחן דלת חלון קיר רצפה מים אוכל אור חושך כאן שוב אין יש איזה
  איזו כזה כזאת אותן הזה הזאת ההוא ההיא שאם אפשר אסור מספיק לגבי בערך בעצם כלל לפחות במקום מספר כמה הכי ראשונה
  אחרונה שנת שנה מוות חיים לב נשמה זכר אמת שקר מילים מילה שאלות תשובה בעיה סיבה דקות שעה שעות יומיים פתאום לאט מהר`.split(/\s+/),
)

/** The names a book's opening repeats: Hebrew words of three letters or more that no story would share by chance (not
 *  in COMMON), counted with their forms after a prefix (\"וקאל\", \"לקאל\" are \"קאל\"); those said twice or more, most
 *  said first. The front matter (the credits, the copyright notice) is left out, so the publisher is not a name. */
export function namesIn(lines: string[], limit = 20): [string, number][] {
  const prose = lines.map(bare).filter((l) => l.split(/\s+/).length >= 5 && !/©|isbn|מסת"ב|זכויות|לשכפל|מוציאים לאור|הוצא|www\.|תרגו?ם|מאנגלית/iu.test(l))
  const counts = new Map<string, number>()
  for (const l of prose) {
    for (const w of l.replace(/[\u0591-\u05C7]/gu, '').match(/[\u05D0-\u05EA][\u05D0-\u05EA'׳]{2,14}/gu) ?? []) {
      const word = w.replace(/['׳]$/u, '')
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  // a form after a one-letter prefix counts for the word itself, when the book has it alone too
  for (const [w, n] of [...counts]) {
    const rest = w.slice(1)
    if (/^[והלבמשכ]/u.test(w) && rest.length >= 3 && counts.has(rest)) {
      counts.set(rest, counts.get(rest)! + n)
      counts.delete(w)
    }
  }
  return [...counts]
    .filter(([w, n]) => n >= 2 && !COMMON.has(w) && !(/^[והלבמשכ]/u.test(w) && COMMON.has(w.slice(1))))
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit)
}

/** a book's vocabulary for its series' fingerprint: the words its story repeats past the common ones (namesIn), more of
 *  them than its main characters — its places, its invented words, the names of things in its world */
const WORDS = 50
export const wordsIn = (lines: string[]) => namesIn(lines, WORDS)

/**
 * The series whose fingerprint this book's vocabulary has. A series' fingerprint is what its books' words have in
 * common, each word weighed by how rare it is in the whole library (a word every book says, the author's style or the
 * language's, weighs nothing; a word of one series' world weighs much). The book goes with the series whose fingerprint
 * is nearest to its own (cosine), when that is near enough, shares five words at least, and is clearly nearer than any
 * other series (half as much again). Undefined with too few books to tell what is rare.
 */
export function seriesByWords(
  book: [string, number][],
  series: { name: string; books: [string, number][][] }[],
  library: [string, number][][],
): string | undefined {
  const docs = library.filter((d) => d.length)
  if (docs.length < 4 || !book.length) return undefined
  const df = new Map<string, number>()
  for (const d of docs) for (const [w] of d) df.set(w, (df.get(w) ?? 0) + 1)
  const idf = (w: string) => Math.log((docs.length + 1) / ((df.get(w) ?? 0) + 1))
  const vec = (d: [string, number][]) => new Map(d.map(([w, n]) => [w, (1 + Math.log(n)) * idf(w)]))
  const len = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((a, x) => a + x * x, 0))
  const mine = vec(book)
  const mineLen = len(mine)
  if (!mineLen) return undefined
  const scored = series
    .filter((s) => s.books.some((b) => b.length))
    .map((s) => {
      const sum = new Map<string, number>()
      const books = s.books.filter((b) => b.length)
      for (const b of books) for (const [w, x] of vec(b)) sum.set(w, (sum.get(w) ?? 0) + x / books.length)
      let dot = 0
      let shared = 0
      for (const [w, x] of mine) {
        const y = sum.get(w)
        if (y) {
          dot += x * y
          if (x > 0) shared++
        }
      }
      const l = len(sum)
      return { name: s.name, sim: l ? dot / (mineLen * l) : 0, shared }
    })
    .sort((x, y) => y.sim - x.sim)
  const [best, next] = scored
  if (!best || best.sim < 0.2 || best.shared < 5) return undefined
  return !next || best.sim >= next.sim * 1.5 ? best.name : undefined
}

/** The series this book's characters belong to. Characters are a series' and not a single book's: a series' cast is
 *  the names most of its books have among their main ones, so the hero of one book of it, or a guest from another series,
 *  is not in it. A character in the cast of several series (Percy Jackson, a guest in Apollo's) counts the less, the more
 *  series have it. The series is the one whose cast has two of this book's four main characters at least, and clearly
 *  more of its characters than any other series (half as much again); an author's books that share only her style, and
 *  two series of one world that share their cast, give none. */
export function seriesByNames(book: [string, number][], series: { name: string; books: [string, number][][] }[]): string | undefined {
  const casts = series.map((s) => {
    const counts = new Map<string, number>()
    for (const b of s.books) for (const [w] of b.slice(0, CAST)) counts.set(w, (counts.get(w) ?? 0) + 1)
    const need = Math.max(1, Math.ceil(s.books.length / 2))
    return { name: s.name, cast: new Set([...counts].filter(([, n]) => n >= need).map(([w]) => w)) }
  })
  const inSeries = new Map<string, number>()
  for (const c of casts) for (const w of c.cast) inSeries.set(w, (inSeries.get(w) ?? 0) + 1)
  const scored = casts
    .map((c) => {
      let score = 0
      let heroes = 0
      book.slice(0, CAST).forEach(([w], i) => {
        if (!c.cast.has(w)) return
        const weight = 1 / inSeries.get(w)!
        score += i < CORE ? 2 * weight : weight
        if (i < CORE) heroes++
      })
      return { name: c.name, score, heroes }
    })
    .sort((x, y) => y.score - x.score)
  const [best, next] = scored
  if (!best || best.heroes < 2 || best.score < 4) return undefined
  return !next || best.score >= next.score * 1.5 ? best.name : undefined
}

/** how many of a book's most said names are its main characters, and how many make a series' cast */
const CORE = 4
const CAST = 10

/** The original title on a translation's copyright page: the line in Latin letters over its copyright notice that is
 *  neither the authors ("Holly Black and Cassandra Clare") nor the series' line ("MAGISTERIUM V") */
export function originalTitle(opening: string[]): string | undefined {
  const lines = opening.map(bare)
  const at = lines.findIndex((l) => /copyright|©/i.test(l) && !/[\u0590-\u05FF]/u.test(l) && !/hebrew/i.test(l))
  if (at < 1) return undefined
  for (let i = at - 1; i >= Math.max(0, at - 4); i--) {
    const l = lines[i]!
    if (!latinOnly(l) || BYLINE.test(l) || SERIES_LINE.test(l) || !/[A-Za-z]{3}/.test(l) || /^(?:a novel|novel|original title)/i.test(l)) continue
    return l
  }
  return undefined
}

/** a list of a series' books as a book prints it (\"ספרים נוספים בסדרה\", \"סדרת כס הזכוכית:\"), each title with its number */
export interface SeriesList {
  /** the series' name when the heading gives it (\"סדרת כס הזכוכית\"); empty for \"ספרים נוספים בסדרה\" */
  series: string
  books: { title: string; number: string }[]
}

const ORDINALS: Record<string, number> = {
  ראשון: 1, שני: 2, שלישי: 3, רביעי: 4, חמישי: 5, שישי: 6, שביעי: 7, שמיני: 8, תשיעי: 9, עשירי: 10,
}
// a heading of a list of the series' books, with the series' name when it gives one
const LIST_HEAD = /^(?:(?:ספרים נוספים|עוד ספרים|הספרים|כל הספרים|עוד)\s+)?ב?סדר(?:ה|ת\s+["״׳']?(.+?)["״׳']?)\s*:?$/u
const LIST_HEAD_PLAIN = /^(?:ספרים נוספים|עוד ספרים|הספרים)\s+בסדרה\s*:?$/u
// lines that end a list: credits, a sentence, another kind of heading
const NOT_ENTRY = /©|isbn|מסת"ב|זכויות|הוצא|www\.|תרגו?ם|מאנגלית|^מאותו|^ספרים נוספים מאת|^עוד מאת/iu

/** an entry of a list: its title and the number it states (\"1. כס הזכוכית\", \"ספר שני: כתר חצות\", \"כתר חצות (2)\") */
function entry(line: string): { title: string; number?: number } | undefined {
  let t = line.replace(/^[•·*\-–—]\s*/u, '').replace(/\s*[([]?בקרוב[)\]]?\s*$/u, '').trim()
  let number: number | undefined
  const lead = /^(\d{1,2})\s*[.)\-–—:]\s*(.+)$/u.exec(t)
  const word = /^ספר\s+(\S+)\s*[:\-–—]\s*(.+)$/u.exec(t)
  const tail = /^(.+?)\s*[([](?:ספר\s*)?(\d{1,2})[)\]]$/u.exec(t)
  if (lead) [number, t] = [Number(lead[1]), lead[2]!]
  else if (word && ORDINALS[word[1]!]) [number, t] = [ORDINALS[word[1]!], word[2]!]
  else if (tail) [t, number] = [tail[1]!, Number(tail[2])]
  t = t.replace(/^["״׳']|["״׳']$/gu, '').trim()
  if (!/[\u05D0-\u05EA]{2}/u.test(t) || /[A-Za-z]/.test(t) || t.split(/\s+/).length > 8 || NOT_ENTRY.test(t) || /[.!?]$/.test(t)) return undefined
  // a half-title's "ספר חמישי" or "מאת …" is no book of the list
  if (/^(?:ה?ספר|כרך|חלק)\s+\S+$|^מאת\b/u.test(t)) return undefined
  return { title: t, ...(number && { number }) }
}

/** The lists of a series' books a book prints, in its opening or its last pages: two books at least each, numbered as
 *  they say or else by their place in the list. */
export function seriesLists(lines: string[]): SeriesList[] {
  const lists: SeriesList[] = []
  for (let i = 0; i < lines.length; i++) {
    const head = bare(lines[i]!)
    const m = LIST_HEAD.exec(head)
    if (!m && !LIST_HEAD_PLAIN.test(head)) continue
    const items: { title: string; number?: number }[] = []
    for (let j = i + 1; j < lines.length && items.length < 25; j++) {
      const line = bare(lines[j]!)
      if (!line) continue
      if (LIST_HEAD.test(line) || LIST_HEAD_PLAIN.test(line)) break
      const e = entry(line)
      if (!e) break
      items.push(e)
    }
    // three books at least, or two that say their numbers: a half-title ("סדרת X" over the title and the author) is no list
    if (items.length < 3 && !(items.length === 2 && items.every((e) => e.number))) continue
    lists.push({
      // the series' name without what a heading adds after a dash ("התנגשות — מארז פשע חושני")
      series: (m?.[1] ?? '').split(/\s+[-–—]\s+|:/u)[0]!.trim(),
      books: items.map((e, k) => ({ title: e.title, number: String(e.number ?? k + 1) })),
    })
  }
  return lists
}

/** The series and number a title has in these lists: the same in all that name it, else undefined */
export function inLists(
  title: string,
  lists: SeriesList[],
  norm: (s: string) => string,
): { series: string; number: string; others: string[] } | undefined {
  const t = norm(title)
  if (!t) return undefined
  const found = new Map<string, { series: string; number: string; others: string[] }>()
  for (const l of lists) {
    const b = l.books.find((x) => norm(x.title) === t)
    if (b) found.set(`${norm(l.series)}|${b.number}`, { series: l.series, number: b.number, others: l.books.map((x) => x.title).filter((x) => norm(x) !== t) })
  }
  // a list that names its series says more than one that does not: \"סדרת X\" and \"בסדרה\" agree when their numbers do
  const named = [...found.values()].filter((f) => f.series)
  const all = [...found.values()]
  const numbers = new Set(all.map((f) => f.number))
  if (numbers.size !== 1) return undefined
  const names = new Set(named.map((f) => norm(f.series)))
  if (names.size > 1) return undefined
  return named[0] ?? all[0]
}


// ---- the book before and the book after: what a book says of its neighbours in the series. Its last pages often open
// the next book ("הספר הבא בסדרה: …", "פרק ראשון מתוך …", "המשך יבוא ב״…״"), and its opening may name the one it
// follows ("ההמשך ל״…״", "בספר הקודם, ״…״"). A title named so is a book of the same series, one number after or before.

const QUOTED = /["״“”]([^"״“”]{2,60})["״“”]/u
const NEXT_LINE: RegExp[] = [
  /^(?:ה)?ספר הבא(?:\s+בסדרה)?\s*[:\-–—]\s*(.+)$/u,
  /^(?:פרק\s+(?:ראשון|1|א['׳]?)|קטע|טעימה|הצצה|פרק)\s+(?:מתוך|מ)\s*(?:ה?ספר(?:\s+הבא)?\s*)?[:\-–—]?\s*(.+)$/u,
  /^(?:בקרוב|יצא בקרוב|המשך יבוא|המשך הסיפור)\s*(?:ב(?:ספר)?\s*)?[:\-–—]?\s*(.+)$/u,
  /^(?:coming (?:next|soon)|look for|next in the series)\s*:?\s*(.+)$/iu,
  /(?:an excerpt|a sneak peek|a preview|the first chapter)\s+(?:from|of)\s+(.+?)$/iu,
]
const NEXT_QUOTED = /(?:בספר הבא|המשך יבוא ב|ההמשך ב|בקרוב ב)[,\s]*(?:ספר\s+)?["״“”]([^"״“”]{2,60})["״“”]/u
const PREV_LINE: RegExp[] = [
  /^(?:ספר\s+)?ה?המשך\s+(?:ל|של\s+)(?:ה?ספר\s+)?(.+)$/u,
  /^(?:ה)?ספר הקודם(?:\s+בסדרה)?\s*[:\-–—]\s*(.+)$/u,
  /^(?:the\s+)?sequel to\s+(.+)$/iu,
  /^(?:the\s+)?(?:follow-up|companion) to\s+(.+)$/iu,
]
const PREV_QUOTED = /(?:בספר הקודם|ההמשך ל|המשך ל|ספר ההמשך ל)[,\s]*(?:ספר\s+)?["״“”]([^"״“”]{2,60})["״“”]/u

/** a title as a line names it: without its quotes, a trailing period or comma, and the author after "מאת" or "by" */
function titleIn(raw: string): string | undefined {
  const q = QUOTED.exec(raw)
  let t = (q ? q[1]! : raw).replace(/\s+(?:מאת|by)\s+.+$/iu, '').replace(/[.,:;!?…]+$/u, '').trim()
  t = t.replace(/^["״“”']|["״“”']$/gu, '').trim()
  const words = t.split(/\s+/).length
  if (!/\p{L}{2}/u.test(t) || words > 8 || /^(?:ה?ספר|הסדרה|בסדרה|יבוא|chapter|book)$/iu.test(t)) return undefined
  return t
}

function titlesBy(lines: string[], line: RegExp[], quoted: RegExp): string[] {
  const out: string[] = []
  for (const l of lines.map(bare)) {
    if (!l || l.split(/\s+/).length > 30) continue
    const q = quoted.exec(l)
    if (q) out.push(q[1]!.trim())
    else if (l.split(/\s+/).length <= 12)
      for (const re of line) {
        const m = re.exec(l)
        const t = m && titleIn(m[1]!)
        if (t) {
          out.push(t)
          // "ההמשך ללחלום על 10": the ל taken as the joining one may be the title's own
          if (re === PREV_LINE[0]) out.push(`ל${t}`)
          break
        }
      }
  }
  return [...new Set(out)].slice(0, 4)
}

/** the titles a book names as the next one of its series (in its last pages) and as the one before (in its opening) */
export function sequels(opening: string[], end: string[]): { next: string[]; prev: string[] } {
  return { next: titlesBy(end, NEXT_LINE, NEXT_QUOTED), prev: titlesBy(opening, PREV_LINE, PREV_QUOTED) }
}
