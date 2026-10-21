// ISBNs printed in a book (its copyright page, "ISBN 978-965-xxx" or "מסת״ב") or kept in an EPUB's identifiers. An ISBN
// names one edition exactly, so Google Books finds the book by it even when its title says nothing.

const SEP = String.raw`[\s\-‐‑–]?`
// ISBN-13 (978/979 and ten more digits) or ISBN-10 (nine digits and a check digit or X), with dashes or spaces between
const CANDIDATE = new RegExp(String.raw`(?<![\dXx])(?:97[89]${SEP}(?:\d${SEP}){9}\d|(?:\d${SEP}){9}[\dXx])(?![\dXx])`, 'g')
// a line that says it holds an ISBN: "ISBN", "מסת״ב" (מספר סטנדרטי תקני בינלאומי לספר)
const LABEL = /isbn|מסת["״']?ב/i

function valid13(d: string): boolean {
  if (!/^97[89]\d{10}$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 13; i++) sum += Number(d[i]) * (i % 2 ? 3 : 1)
  return sum % 10 === 0
}

function valid10(d: string): boolean {
  if (!/^\d{9}[\dX]$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) sum += (d[i] === 'X' ? 10 : Number(d[i])) * (10 - i)
  return sum % 11 === 0
}

/** an ISBN-10 as the ISBN-13 of the same book */
function to13(d10: string): string {
  const body = `978${d10.slice(0, 9)}`
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 ? 3 : 1)
  return body + ((10 - (sum % 10)) % 10)
}

/** The valid ISBNs in one piece of text, as ISBN-13. An ISBN-10 is taken only from a line that says ISBN, since ten
 *  digits elsewhere may be a phone number; an ISBN-13 starts with 978 or 979 and is taken anywhere. */
export function isbnsIn(text: string): string[] {
  const labelled = LABEL.test(text)
  const out: string[] = []
  for (const m of text.matchAll(CANDIDATE)) {
    const d = m[0].replace(/[^\dXx]/g, '').toUpperCase()
    const isbn = d.length === 13 ? (valid13(d) ? d : undefined) : labelled && valid10(d) ? to13(d) : undefined
    if (isbn && !out.includes(isbn)) out.push(isbn)
  }
  return out
}

/** The ISBNs in a book's lines and identifiers, without repeats. For a Hebrew book, Israeli ISBNs (978-965) come first:
 *  a translated book's copyright page often names the original's ISBN too. */
export function bookIsbns(sources: string[], hebrewBook: boolean): string[] {
  const all: string[] = []
  for (const s of sources) for (const isbn of isbnsIn(s)) if (!all.includes(isbn)) all.push(isbn)
  return hebrewBook ? [...all.filter((i) => i.startsWith('978965')), ...all.filter((i) => !i.startsWith('978965'))] : all
}
