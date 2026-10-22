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

/** The number a book of a series has, from the numbers the library already has in it: the only one missing (2 when there
 *  are 1 and 3), or the next one (4 after 1, 2 and 3); and when several fit (2 or 5 after 1, 3 and 4), the one the years
 *  agree with: a book first published after the others comes after them. Undefined when that does not decide it. */
export function numberByGaps(members: { number: number; year?: number }[], year?: number): number | undefined {
  if (!members.length) return undefined
  const have = new Set(members.map((m) => m.number))
  const max = Math.max(...have)
  const gaps: number[] = []
  for (let i = 1; i <= max + 1; i++) if (!have.has(i)) gaps.push(i)
  const fits = year
    ? gaps.filter((g) => members.every((m) => m.year === undefined || (m.number < g ? m.year <= year : m.year >= year)))
    : gaps
  return fits.length === 1 ? fits[0] : undefined
}
