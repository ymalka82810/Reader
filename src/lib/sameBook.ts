/** Compare ignoring case, nikud/accents, punctuation and quote styles, so "ספר: הכותרת" matches "ספר - הכותרת". */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase()

/** with no author on one side, a title this short ("מבוא", "Introduction") is too generic to call a match */
const MIN_TITLE_WITHOUT_AUTHOR = 8

/** Same book in another format or under another file name (so different bytes/hash): match on title + author.
 *  A missing author on either side (common with PDFs) still counts as a match, but only for a distinctive title.
 *  A title with no letters or digits at all never matches. */
export function sameBook(a: { title: string; author: string }, b: { title: string; author: string }): boolean {
  const title = norm(a.title)
  if (!title || title !== norm(b.title)) return false
  const authorA = norm(a.author)
  const authorB = norm(b.author)
  if (authorA && authorB) return authorA === authorB
  return title.length >= MIN_TITLE_WITHOUT_AUTHOR
}
