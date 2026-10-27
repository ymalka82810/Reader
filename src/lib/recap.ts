/** a book opened again after this long away shows "where was I?" */
export const RECAP_AFTER_MS = 3 * 24 * 60 * 60 * 1000
/** how much of the text read last is shown */
const RECAP_CHARS = 360

/** whole days between two times */
export const daysAway = (lastOpened: number, now = Date.now()) => Math.floor((now - lastOpened) / (24 * 60 * 60 * 1000))

/**
 * The end of a text, about `max` characters long: from the start of a sentence when one starts in the first half of
 * that stretch, otherwise from a word boundary with an ellipsis, so it never opens in the middle of a word.
 */
export function lastPassage(text: string, max = RECAP_CHARS): string {
  const s = text.replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const cut = s.slice(-max)
  const sentence = cut.search(/[.!?…:;״"]\s+\S/)
  if (sentence >= 0 && sentence < max / 2) return cut.slice(sentence + 1).trim()
  const space = cut.indexOf(' ')
  return '…' + (space >= 0 ? cut.slice(space + 1) : cut)
}

/** the text of the section before `range` (where the reader stopped), the end of it as lastPassage cuts it */
export function textBefore(range: Range, max = RECAP_CHARS): string {
  const doc = range.startContainer.ownerDocument
  const body = doc?.body
  if (!doc || !body || !body.contains(range.startContainer)) return ''
  const before = doc.createRange()
  before.setStart(body, 0)
  before.setEnd(range.startContainer, range.startOffset)
  return lastPassage(before.toString(), max)
}
