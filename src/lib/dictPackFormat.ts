// What an offline dictionary pack holds and how a word finds its place in it. Shared by the app (offlineDict.ts) and by
// scripts/build-dictionary-packs.mjs, which Node runs straight from this file: keep it free of imports and of anything
// that is not erasable TypeScript.

export const PACK_VERSION = 2

/**
 * One meaning of a written word: its part of speech (p), definitions (g), how it is written in full when that differs from
 * the lookup key (h, e.g. the niqqud that tells סֵפֶר from סַפָּר) and the words related to this meaning (r). A word
 * written the same way for several meanings has one entry for each, and the reader picks one.
 */
export type PackEntry = { p: string; g: string[]; h?: string; r?: Relations }
/** an entry as version 1 packs stored it: part of speech, then the definitions; its relations were per word (Shard.r) */
type PackEntryV1 = [pos: string, ...glosses: string[]]

/** words that relate to a headword: synonyms (s), antonyms (a), related words (r) and words derived from it (d) */
export type Relations = Partial<Record<RelationKind, string[]>>
export type RelationKind = 's' | 'a' | 'r' | 'd'

/**
 * a slice of a pack: the entries of the words that hash here and the inflected forms that point at their base word
 * (a version 1 pack, still on some devices, has PackEntryV1 entries and the related words of each word in `r`)
 */
export type Shard = { e: Record<string, (PackEntry | PackEntryV1)[]>; f: Record<string, string>; r?: Record<string, Relations> }

/** the first line of a pack file; every line after it is one shard */
export type PackHeader = { v: number; lang: string; shards: number; words: number; built: string }

const HEBREW_MARKS = /[֑-ׇ]/g
const ARABIC_MARKS = /[ـً-ٰٟ]/g

/** the key a word is stored and looked up under: niqqud, cantillation and Arabic vowel signs do not matter to a reader */
export function normalizeWord(lang: string, word: string): string {
  const w = word.normalize('NFC')
  if (lang === 'he') return w.replace(HEBREW_MARKS, '')
  if (lang === 'ar') return w.replace(ARABIC_MARKS, '')
  return w
}

/** which of `shards` slices holds `key` (FNV-1a over its UTF-16 units) */
export function shardOf(key: string, shards: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % shards
}

const MAX_WORD = 60
const MAX_GLOSS = 200
const MAX_GLOSSES = 3
const MAX_ENTRIES = 8

/** the parts of a kaikki.org (wiktextract) line the packs use */
type KaikkiLink = { word?: string }
type KaikkiLinks = { synonyms?: KaikkiLink[]; antonyms?: KaikkiLink[]; related?: KaikkiLink[]; derived?: KaikkiLink[] }

export type KaikkiLine = KaikkiLinks & {
  word?: string
  pos?: string
  senses?: (KaikkiLinks & { glosses?: string[]; form_of?: KaikkiLink[]; alt_of?: KaikkiLink[] })[]
  /** the word's inflection table and head forms: plural, construct state, conjugations, declensions */
  forms?: { form?: string; tags?: string[] }[]
}

/** tags of rows in `forms` that are not another way to write the word: transliterations, table captions and the like */
const NOT_A_FORM = new Set(['romanization', 'transliteration', 'table-tags', 'inflection-template', 'class', 'canonical', 'error-unknown-tag'])

/**
 * Adds one line of a kaikki.org dump to the pack being built: its definitions under the word, and, when the line is an
 * inflected form or a variant spelling of another word, a pointer to that word.
 */
export function addKaikkiLine(
  lang: string,
  line: KaikkiLine,
  entries: Map<string, PackEntry[]>,
  forms: Map<string, string>,
  tableForms?: Map<string, string>,
) {
  if (!line.word || line.word.length > MAX_WORD) return
  const key = normalizeWord(lang, line.word)
  const glosses: string[] = []
  for (const sense of line.senses ?? []) {
    const base = sense.form_of?.[0]?.word ?? sense.alt_of?.[0]?.word
    if (base) {
      const baseKey = normalizeWord(lang, base)
      if (baseKey !== key && !forms.has(key)) forms.set(key, baseKey)
      continue
    }
    const gloss = sense.glosses?.at(-1)?.trim()
    if (gloss && glosses.length < MAX_GLOSSES && !glosses.includes(gloss)) glosses.push(gloss.length > MAX_GLOSS ? gloss.slice(0, MAX_GLOSS - 1).trimEnd() + '…' : gloss)
  }
  if (!glosses.length || !line.pos) return
  const list = entries.get(key) ?? []
  if (list.length < MAX_ENTRIES) {
    const entry: PackEntry = { p: line.pos, g: glosses }
    // the word as the dictionary writes it: the canonical form (the English Wiktionary puts the niqqud there) or the word itself
    const full = line.forms?.find((f) => f.tags?.includes('canonical'))?.form?.trim() ?? line.word
    if (full !== key && full.length <= MAX_WORD && normalizeWord(lang, full) === key) entry.h = full
    const related = relationsOf(lang, key, line)
    if (related) entry.r = related
    list.push(entry)
  }
  entries.set(key, list)
  // most inflected forms have no line of their own and appear only in the table of their base word; those go to
  // `tableForms` when given, so the caller can drop the ones that are headwords themselves (see mergeTableForms)
  const fromTables = tableForms ?? forms
  for (const f of line.forms ?? []) {
    if (!f.form || f.form.length > MAX_WORD || /\s/.test(f.form) || f.tags?.some((tag) => NOT_A_FORM.has(tag))) continue
    const formKey = normalizeWord(lang, f.form.replace(/^[-־]+|[-־]+$/g, ''))
    if (formKey && formKey !== key && !fromTables.has(formKey)) fromTables.set(formKey, key)
  }
}

/**
 * Adds the forms read from inflection tables to `forms`, except a form that is a headword of its own ("maison" in the
 * table of a rare spelling, "Haus" in that of "Hau"): a reader looking it up means that word, not another one's form.
 * A form a line of its own declares (`form_of`) is kept whatever it is.
 */
export function mergeTableForms(forms: Map<string, string>, tableForms: Map<string, string>, entries: Map<string, unknown>) {
  for (const [form, base] of tableForms) if (!forms.has(form) && !entries.has(form)) forms.set(form, base)
}

const MAX_RELATED = 8
const LINK_FIELDS: [RelationKind, keyof KaikkiLinks][] = [['s', 'synonyms'], ['a', 'antonyms'], ['r', 'related'], ['d', 'derived']]

/** the synonyms, antonyms, related and derived words of a line and of its senses, a few of each, as lookup keys */
function relationsOf(lang: string, key: string, line: KaikkiLine): Relations | undefined {
  const rel: Relations = {}
  for (const [kind, field] of LINK_FIELDS) {
    const links = [...(line[field] ?? []), ...(line.senses ?? []).flatMap((sense) => sense[field] ?? [])]
    for (const link of links) {
      const list = rel[kind] ?? []
      if (list.length >= MAX_RELATED) break
      // "Thesaurus:…" and the like are pages, not words
      if (!link.word || link.word.length > MAX_WORD || link.word.includes(':')) continue
      const w = normalizeWord(lang, link.word.trim())
      if (w && w !== key && !list.includes(w)) rel[kind] = [...list, w]
    }
  }
  return Object.keys(rel).length ? rel : undefined
}
