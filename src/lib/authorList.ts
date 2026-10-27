// A book of two authors keeps them in one field, "ניל גיימן, טרי פראצ'ט" (tidyAuthor turns "ו־", "and" and "&" into
// commas). One comma is also how a single name is turned around ("רולינג, ג'יי קיי", "Rowling, J. K."), so two parts
// are a list only when both are whole names: neither is a single word, a suffix ("Jr.") or initials.
const SUFFIX = /^(?:jr|sr|ii|iii|iv)\.?$/iu
const INITIALS = /^(?:\p{L}{1,2}(?:['׳"״]\.?|\.)\s*)+$/u

/** the authors a name lists, in its own order; one name (or none) when it is not a list */
export function authorsIn(name: string): string[] {
  const whole = name.replace(/\s+/g, ' ').trim()
  const parts = whole.split(/[,;]/).map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return whole ? [whole] : []
  const oneName = (p: string) => !p.includes(' ') || SUFFIX.test(p) || INITIALS.test(p)
  if (parts.length === 2 && !whole.includes(';') && parts.some(oneName)) return [whole]
  return parts
}
