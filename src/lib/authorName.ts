// One author under several spellings: "ג'יי קיי רולינג", "ג'. ק. רולינג", "רולינג, ג'יי קיי" and "J.K. Rowling" are
// one person. They are compared by how they sound (soundOf: the consonants, the same for Hebrew and Latin letters),
// with "last, first" turned around first. A name the library already has for the author is the one kept, so the
// author's books stay in one folder and the library's series count as the author's (byLibrary's "sure").
import { decodeEntities } from './entities'
import { soundOf } from './bookInference'
import { norm } from './sameBook'

/** "רולינג, ג'יי קיי" is "ג'יי קיי רולינג"; a name with more than one comma (a list of authors) is left as it is */
export function authorOrder(a: string): string {
  const parts = a.split(',')
  if (parts.length !== 2) return a.trim()
  const [last, first] = parts.map((p) => p.trim())
  // "Smith, Jr." or a comma before an "and" is no inversion
  if (!last || !first || /^(?:jr|sr|ii|iii|iv)\.?$/iu.test(first) || /^(?:and|ו)\s|&/iu.test(first)) return a.trim()
  return `${first} ${last}`
}

/**
 * The author field as a name: without the word that introduces it ("מאת: ריק ריירדן", "by Rick Riordan") or the role after
 * it ("ריק ריירדן (מחבר)"), and two authors joined by "ו־", "and" or "&" as a list ("ניל גיימן, טרי פראצ'ט"). A name in
 * parentheses that is the author's other spelling ("(טרי פראצט; Terry Pratchett)") is not a role and stays.
 */
export function tidyAuthor(a: string): string {
  return decodeEntities(a)
    .replace(/^\s*(?:מאת|by)(?![\p{L}])\s*[:：]?\s*/iu, '')
    .replace(/\s*\((?:מחבר|מחברת|מחברים|סופר|סופרת|כותב|כותבת|author|authors|writer)\)/giu, '')
    .replace(/\s+(?:ו[-־‐–]|and\s+|&\s*)(?=\S)/giu, ', ')
    .replace(/\s*[,;]?\s+(?:YIT|z-?library(?:\.\w+)?|libgen|pdfdrive)\s*$/iu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// What a file's author field holds when no author was ever written in it: the program that made the file, the
// placeholder a tool puts there, or the user name of the account that made the file.
const NOT_AN_AUTHOR =
  /^(?:unknown(?:\s+author)?|anonymous|n\/?a|none|null|undefined|author|admin|administrator|user|owner|ללא\s+מחבר|לא\s+ידוע|אלמוני|aspose(?:\.\w+)?|camscanner|adobe(?:\s+\w+)*|microsoft(?:\s+\w+)*|word|calibre|libreoffice|pdf(?:\s*\w+)?|scanner|scan(?:ned)?|wps(?:\s+\w+)*|google(?:\s+docs)?|kindle|epub|ebook|ocr)$/iu

/**
 * The author as it may be kept: the entities decoded, a source tag ("..., YIT") off, and empty when the field holds no
 * author — a program or placeholder name, an e-mail address, or a lone lower-case Latin word (an account's user name:
 * a real name is written with a capital, or in two words).
 */
export function realAuthor(a: string | undefined): string {
  const v = tidyAuthor(a ?? '')
  if (!v || /@/.test(v) || NOT_AN_AUTHOR.test(v) || /^[a-z][a-z0-9_.-]*\d*$/.test(v)) return ''
  return v
}

/** the author as the name sounds, in the order first-last; empty for a name too short to tell (fewer than 4 sounds) */
export function authorKey(a: string): string {
  const k = soundOf(authorOrder(a.replace(/\([^)]*\)/g, ' ')))
  return k.length >= 4 ? k : ''
}

const lastName = (a: string) => authorOrder(a).replace(/[.,]/g, ' ').trim().split(/\s+/).pop() ?? ''

/** whether two names are one author: the same letters, or the same sound */
export function sameAuthor(a: string, b: string): boolean {
  if (!norm(a) || !norm(b)) return false
  if (norm(a) === norm(b)) return true
  const ka = authorKey(a)
  return !!ka && ka === authorKey(b)
}

/**
 * The name the library has for this author (`authors`: the library's authors), when it is spelt otherwise: the same
 * sound; or, for a name of one word ("Rowling"), the one author in the library whose last name sounds so. Undefined
 * when the library has the very name, or has no such author, or more than one.
 */
export function libraryAuthor(a: string, authors: readonly string[]): string | undefined {
  if (!norm(a) || authors.some((x) => norm(x) === norm(a))) return undefined
  const key = authorKey(a)
  const same = key ? [...new Set(authors.filter((x) => authorKey(x) === key))] : []
  if (same.length === 1) return same[0]
  if (same.length > 1) return undefined
  if (/\s/.test(authorOrder(a).replace(/[.,]/g, ' ').trim())) return undefined
  const sound = soundOf(a)
  if (sound.length < 4) return undefined
  const byLast = [...new Set(authors.filter((x) => soundOf(lastName(x)) === sound))]
  return byLast.length === 1 ? byLast[0] : undefined
}
