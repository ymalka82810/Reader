/**
 * Which parts of a book were actually read, as sorted, non-overlapping [from, to] fractions of the book.
 * A book counts as read only when most of it was read, not when its position was simply dragged to the end.
 */
export type ReadRanges = [number, number][]

/** this much of the book read (and its end reached) makes it read */
const READ_ENOUGH = 0.9
/** the end of the book, as far as the position goes */
const END_FRACTION = 0.98
/** gaps smaller than this between two read stretches are closed (a page that slipped between two saves) */
const JOIN = 0.002

const round = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000

/** adds the stretch [a, b] and merges it with the stretches it touches */
export function addRange(ranges: ReadRanges | undefined, a: number, b: number): ReadRanges {
  const lo = round(Math.min(a, b))
  const hi = round(Math.max(a, b))
  const all = [...(ranges ?? []), [lo, hi] as [number, number]].sort((x, y) => x[0] - y[0])
  const out: ReadRanges = []
  for (const [s, e] of all) {
    const last = out[out.length - 1]
    if (last && s <= last[1] + JOIN) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

/** both sets of stretches together */
export const unionRanges = (a: ReadRanges | undefined, b: ReadRanges | undefined): ReadRanges | undefined =>
  !a ? b : !b ? a : b.reduce<ReadRanges>((acc, [s, e]) => addRange(acc, s, e), a)

/** how much of [0, upTo] was read, as a fraction of the whole book */
export function coveredBefore(ranges: ReadRanges | undefined, upTo = 1): number {
  let sum = 0
  for (const [s, e] of ranges ?? []) if (s < upTo) sum += Math.min(e, upTo) - s
  return sum
}

/**
 * Whether a book at `fraction` counts as read. Without `ranges` (books from before the read stretches were kept,
 * audiobooks) reaching the end is enough.
 */
export const readThrough = (fraction: number, ranges: ReadRanges | undefined) =>
  fraction >= END_FRACTION && (!ranges || coveredBefore(ranges) >= READ_ENOUGH)

/** valid stretches from storage or a backup, anything else dropped */
export function cleanRanges(v: unknown): ReadRanges | undefined {
  if (!Array.isArray(v)) return undefined
  let out: ReadRanges = []
  for (const r of v)
    if (Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'number' && Number.isFinite(x))) out = addRange(out, r[0], r[1])
  return out
}
