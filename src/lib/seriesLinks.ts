// Links between the books of a series that come from places the names do not: the house that published and translated
// them (`house`), the design of their covers (`design`), the order their words first appear in (`debut`), and the whole
// series placed at once (`joint`, by an assignment of books to places that every clue weighs together). Each gives the
// weighing (bookLookup's weigh) one more clue that is independent of the name it checks. All of it runs on the device.

import { norm } from './sameBook'

// ---- the house: publisher, translator and the ISBN's publisher block

const TRANSLATOR = [
  /^(?:תרגום|תרגם|תרגמה|תירגם|תירגמה|תרגמו)(?:\s+מ\S+)?\s*[:：-]?\s*(.*)$/u,
  /^translated(?:\s+from\s+(?:the\s+)?\S+)?\s+by\s+(.*)$/i,
]
const PUBLISHER = [
  /(?:^|\s)הוצא(?:ת|ה\s+לאור)\s*[:：-]?\s*(\S+(?:\s+\S+)?)/u,
  /כל\s+הזכויות\s+(?:בעברית\s+)?שמורות\s+ל(?:הוצאת\s+)?(\S+(?:\s+\S+)?)/u,
  /^published\s+by\s+(.*)$/i,
]
const ISBN_BLOCK = /\b(97[89])[-‐‑ ](\d{1,5})[-‐‑ ](\d{1,7})[-‐‑ ]\d/

/** a name as compared: without punctuation and the leading ו/ל/ה a credit line adds, its first two words */
function key(s: string): string {
  const words = norm(s.replace(/[(),.;:׳'"״]/g, ' ')).split(' ').filter(Boolean)
  return words
    .slice(0, 2)
    .map((w, i) => (i === 0 && /^[והל]\p{L}{3,}/u.test(w) && !/^(?:הוצא)/u.test(w) ? w.slice(1) : w))
    .join(' ')
}

/**
 * Who made this edition, as its copyright page says: the translator (\"t:\"), the publisher (\"p:\"), and the publisher's
 * block of the ISBN (\"i:978-965-07\", only when printed with its hyphens, since the block's length is not fixed).
 */
export function houseOf(lines: string[]): string[] {
  const out = new Set<string>()
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim()
    if (!line || line.length > 160) continue
    for (const re of TRANSLATOR) {
      const m = re.exec(line)
      if (!m) continue
      // the name on the next line, when the credit is alone on its own
      const who = key(m[1]?.trim() || lines[i + 1] || '')
      if (who && who.length >= 3 && !/\d/.test(who)) out.add(`t:${who}`)
    }
    for (const re of PUBLISHER) {
      const m = re.exec(line)
      const who = m ? key(m[1]!) : ''
      if (who && who.length >= 2 && !/\d/.test(who)) out.add(`p:${who.split(' ')[0]}`)
    }
    const b = ISBN_BLOCK.exec(line)
    if (b) out.add(`i:${b[1]}-${b[2]}-${b[3]}`)
  }
  return [...out]
}

/**
 * The house's say on a series: the book agrees with it when it shares its translator, its publisher or its ISBN block with
 * most of the series' books that say theirs (two of them at least for a publisher or a block, one for a translator), and
 * that one is not what most of the library shares anyway (a publisher of half the library says nothing of a series).
 * It never speaks against: a series moves to another publisher or translator at times.
 */
export function houseVerdict(own: string[], members: string[][], library: string[][]): 'agree' | undefined {
  for (const k of own) {
    const type = k.slice(0, 2)
    const told = members.filter((m) => m.some((x) => x.startsWith(type)))
    const share = told.filter((m) => m.includes(k)).length
    if (!share || share * 2 <= told.length || (type !== 't:' && share < 2)) continue
    const all = library.filter((m) => m.some((x) => x.startsWith(type)))
    const common = all.filter((m) => m.includes(k)).length
    if (all.length >= 6 && common / all.length >= 0.34) continue
    return 'agree'
  }
  return undefined
}

// ---- the cover's design: a print of its layout and colours

/**
 * A cover's print from its pixels: the difference hash of a 9×8 grey image (64 bits, the shape of its light and dark),
 * then the colours of a 3×3 grid. `grey` is 72 values (9 wide, 8 high), `rgb` 27 (3×3, red green blue).
 */
export function printOf(grey: ArrayLike<number>, rgb: ArrayLike<number>): string {
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += grey[y * 9 + x]! < grey[y * 9 + x + 1]! ? '1' : '0'
  let hash = ''
  for (let i = 0; i < 64; i += 4) hash += parseInt(bits.slice(i, i + 4), 2).toString(16)
  const colours = Array.from({ length: 27 }, (_, i) => Math.max(0, Math.min(255, Math.round(rgb[i]!))).toString(16).padStart(2, '0')).join('')
  return `${hash}.${colours}`
}

/** how far two covers' prints are, 0 (the same) to 2: the share of their hash bits that differ plus how far their colours are */
export function printDistance(a: string, b: string): number {
  const [ha = '', ca = ''] = a.split('.')
  const [hb = '', cb = ''] = b.split('.')
  if (ha.length !== 16 || hb.length !== 16 || ca.length !== 54 || cb.length !== 54) return 2
  let bits = 0
  for (let i = 0; i < 16; i++) {
    let v = parseInt(ha[i]!, 16) ^ parseInt(hb[i]!, 16)
    while (v) {
      bits += v & 1
      v >>= 1
    }
  }
  let colour = 0
  for (let i = 0; i < 54; i += 2) colour += Math.abs(parseInt(ca.slice(i, i + 2), 16) - parseInt(cb.slice(i, i + 2), 16))
  return bits / 64 + colour / (27 * 255)
}

/** A cover's print, read from its picture (undefined where pictures cannot be drawn, or the picture is unreadable) */
export async function coverPrint(cover: Blob): Promise<string | undefined> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return undefined
  try {
    const img = await createImageBitmap(cover)
    const draw = (w: number, h: number) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d', { willReadFrequently: true })
      if (!g) return undefined
      g.drawImage(img, 0, 0, w, h)
      return g.getImageData(0, 0, w, h).data
    }
    const small = draw(9, 8)
    const grid = draw(3, 3)
    img.close?.()
    if (!small || !grid) return undefined
    const grey = Array.from({ length: 72 }, (_, i) => 0.299 * small[i * 4]! + 0.587 * small[i * 4 + 1]! + 0.114 * small[i * 4 + 2]!)
    const rgb = Array.from({ length: 27 }, (_, i) => grid[Math.floor(i / 3) * 4 + (i % 3)]!)
    return printOf(grey, rgb)
  } catch {
    return undefined
  }
}

/**
 * The design's say on a series: the book's cover is nearer the series' covers (two at least) than nearly all the other
 * covers of the library are (eight at least, to know what near is): its median distance to them is below the nearest
 * quarter of its distances to the rest. It only agrees: a series redesigned on the way says nothing against.
 */
export function designVerdict(own: string, members: string[], others: string[]): 'agree' | undefined {
  if (members.length < 2 || others.length < 8) return undefined
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
  }
  const near = median(members.map((m) => printDistance(own, m)))
  const rest = others.map((m) => printDistance(own, m)).sort((a, b) => a - b)
  const quarter = rest[Math.floor(rest.length / 4)]!
  return near < quarter ? 'agree' : undefined
}

// ---- the debut: the words a series' books share, in the order they first appear

/** How often words skip a book: a word of the series (a character, a place) is in a run of books from the one it first
 *  appears in; a book in the middle of its run that lacks it is a gap. Only words in two books or more count. */
export function debutGaps(books: string[][]): number {
  const at = new Map<string, number[]>()
  books.forEach((ws, i) => {
    for (const w of new Set(ws)) at.set(w, [...(at.get(w) ?? []), i])
  })
  let gaps = 0
  for (const xs of at.values()) if (xs.length >= 2) gaps += xs[xs.length - 1]! - xs[0]! + 1 - xs.length
  return gaps
}

/** how far two books' vocabularies are: 1 less the share of their words they share (Jaccard) */
function apart(a: string[], b: string[]): number {
  const x = new Set(a)
  const y = new Set(b)
  const both = [...x].filter((w) => y.has(w)).length
  const either = x.size + y.size - both
  return either ? 1 - both / either : 1
}

/**
 * What putting the book at each place among the series' books (in their order) costs: the books next to each other in a
 * series share the most words (a series' path through its words is shortest in its own order), so the cost is how much
 * longer the path gets with it there, plus a little for each word it makes skip a book (debutGaps).
 */
export function debutCosts(seq: string[][], own: string[]): number[] {
  return Array.from({ length: seq.length + 1 }, (_, i) => {
    const before = seq[i - 1]
    const after = seq[i]
    const path = (before ? apart(before, own) : 0) + (after ? apart(own, after) : 0) - (before && after ? apart(before, after) : 0)
    return path + 0.05 * debutGaps([...seq.slice(0, i), own, ...seq.slice(i)])
  })
}

/**
 * The debut's say on a number: the book is put at each place among the series' numbered books (three at least, with their
 * vocabulary), and the place that costs least (debutCosts) is where it stands. When that place is the number's, and every
 * other costs clearly more, it agrees. It only agrees: a prequel (written after, set before) or a book of other
 * characters is out of order on purpose.
 */
export function debutVerdict(members: { number: number; words: string[] }[], own: string[], number: number): 'agree' | undefined {
  const seq = members.filter((m) => m.number && m.number !== number && m.words.length).sort((a, b) => a.number - b.number)
  if (seq.length < 3 || !own.length) return undefined
  const costs = debutCosts(
    seq.map((m) => m.words),
    own,
  )
  const mine = seq.filter((m) => m.number < number).length
  const best = Math.min(...costs)
  return costs[mine] === best && costs.every((c, i) => i === mine || c >= best + 0.1) ? 'agree' : undefined
}

// ---- the whole series at once

/** what is known of one book of the series, for placing them all together */
export interface Placed {
  id: string
  /** the number its name gives (not for the book being weighed) */
  number?: number
  /** a name the user gave: it stays where it is */
  anchored?: boolean
  /** its first publication */
  year?: number
  /** the number its own pages give (its package, copyright page, title page) */
  own?: number
  /** the number the series' lists give its title */
  listed?: number
  /** its vocabulary */
  words?: string[]
}

/** what a place is worth for a book, by the series' numbered books it is placed among (`fixed`, with their years), the
 *  catalog's years and its own clues */
function worth(b: Placed, slot: number, fixed: Placed[], years?: Map<number, number>): number {
  if (b.anchored) return b.number === slot ? 0 : -Infinity
  let w = 0
  if (b.number === slot) w += 2 // a name the identification gave: likely, but not sure
  if (b.own === slot) w += 3
  if (b.listed === slot) w += 3
  const y = years?.get(slot)
  if (b.year && y) w += b.year === y ? 2 : Math.abs(b.year - y) === 1 ? 0.5 : -2
  for (const f of fixed) {
    if (f === b || !b.year || !f.year || !f.number || f.number === slot) continue
    w += (slot < f.number) === (b.year <= f.year) ? 0.2 : -1.5
  }
  return w
}

/** The assignment of rows to columns that is worth most (the Hungarian method, on a square matrix of worths) */
function assignment(w: number[][]): number[] {
  const n = w.length
  const BIG = 1e6
  // as costs: the most minus each worth, an impossible place costs BIG
  const top = Math.max(0, ...w.flat().filter(Number.isFinite))
  const a = w.map((r) => r.map((x) => (Number.isFinite(x) ? top - x : BIG)))
  const u = new Array<number>(n + 1).fill(0)
  const v = new Array<number>(n + 1).fill(0)
  const p = new Array<number>(n + 1).fill(0)
  const way = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array<number>(n + 1).fill(Infinity)
    const used = new Array<boolean>(n + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]!
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= n; j++)
        if (!used[j]) {
          const cur = a[i0 - 1]![j - 1]! - u[i0]! - v[j]!
          if (cur < minv[j]!) {
            minv[j] = cur
            way[j] = j0
          }
          if (minv[j]! < delta) {
            delta = minv[j]!
            j1 = j
          }
        }
      for (let j = 0; j <= n; j++)
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta
          v[j] = v[j]! - delta
        } else minv[j] = minv[j]! - delta
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]!
      p[j0] = p[j1]!
      j0 = j1
    } while (j0)
  }
  const out = new Array<number>(n).fill(-1)
  for (let j = 1; j <= n; j++) if (p[j]) out[p[j]! - 1] = j - 1
  return out
}

/**
 * The places in a series every book's clues agree on together: each book a number, no two books one number (a book the
 * user named keeps its own). For `id`: the number given it, and how much better that is than the best placing that gives
 * it any other number (`margin`, 0 when nothing tells its place). `total`: the series' known length, when known.
 */
export function placeSeries(books: Placed[], id: string, { total, years }: { total?: number; years?: Map<number, number> } = {}) {
  // the numbered books: what the others are placed among (a number the identification gave may still move)
  const fixed = books.filter((b) => b.number)
  const top = Math.max(total ?? 0, books.length, ...books.map((b) => b.number ?? 0), ...books.map((b) => b.own ?? 0), ...books.map((b) => b.listed ?? 0))
  const slots = Array.from({ length: Math.min(top, 200) }, (_, i) => i + 1)
  const me = books.findIndex((b) => b.id === id)
  if (me < 0 || !slots.length) return undefined
  // the debut: the place among the numbered books where this book's words fit best
  const seq = fixed.filter((f) => f.words?.length).sort((x, y) => x.number! - y.number!)
  const debut = (b: Placed, slot: number) => {
    if (b.anchored || !b.words?.length) return 0
    const rest = seq.filter((f) => f !== b)
    if (rest.length < 3) return 0
    const costs = debutCosts(
      rest.map((f) => f.words!),
      b.words,
    )
    const i = rest.filter((f) => f.number! < slot).length
    return -5 * (costs[i]! - Math.min(...costs))
  }
  const row = (b: Placed) => slots.map((s) => worth(b, s, fixed, years) + debut(b, s))
  const rows = books.map(row)
  // nothing tells this book's place: no assignment says anything of it
  const mine = rows[me]!.filter(Number.isFinite)
  if (!mine.length || mine.every((x) => x === mine[0])) return { number: undefined, margin: 0 }
  const size = Math.max(rows.length, slots.length)
  const square = (rs: number[][]) => Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => rs[i]?.[j] ?? 0))
  const worthOf = (rs: number[][], x: number[]) => x.reduce((s, j, i) => s + (i < rs.length && j < slots.length ? rs[i]![j]! : 0), 0)
  const best = assignment(square(rows))
  const at = best[me]!
  if (at >= slots.length || !Number.isFinite(rows[me]![at]!)) return { number: undefined, margin: 0 }
  // the best placing with this book anywhere but there
  const without = rows.map((r, i) => (i === me ? r.map((x, j) => (j === at ? -Infinity : x)) : r))
  const second = assignment(square(without))
  const one = worthOf(rows, best)
  const two = Number.isFinite(without[me]![second[me]!] ?? NaN) ? worthOf(without, second) : -Infinity
  return { number: slots[at]!, margin: Number.isFinite(two) ? one - two : 10 }
}

/** The whole series' say on a number found: the joint placing gives it that number clearly (by one point at least) —
 *  agrees; another number, clearly (by two) — speaks against; nothing clear — silent */
export function jointVerdict(books: Placed[], id: string, number: number, known: { total?: number; years?: Map<number, number> } = {}) {
  const p = placeSeries(books, id, known)
  if (!p?.number) return undefined
  if (p.number === number) return p.margin >= 1 ? 'agree' : undefined
  return p.margin >= 2 ? 'against' : undefined
}
