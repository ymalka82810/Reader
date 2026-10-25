import { t } from '../i18n'
import { parseHeWiktionaryPage } from './heWiktionary'
import { baseCandidates } from './morphology'
import { meaningsFromLines, type Meaning } from './offlineDict'

/** the last words looked up, so reopening one (or turning back to it) works without the network */
const cache = new Map<string, string | null>()
const CACHE_MAX = 50
/** a Wiktionary page can run to many languages; the popup only needs the start */
const MAX_CHARS = 4000

export const wiktionaryUrl = (lang: string, word: string) => `https://${lang}.wiktionary.org/wiki/${encodeURIComponent(word)}`

/** the first word of a selection, without the punctuation stuck to it */
export const firstWord = (text: string) =>
  text.trim().split(/\s+/)[0]?.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '') ?? ''

const api = (lang: string, params: Record<string, string>, signal?: AbortSignal) =>
  fetch(`https://${lang}.wiktionary.org/w/api.php?${new URLSearchParams({ ...params, format: 'json', formatversion: '2', origin: '*' })}`, { signal }).then((res) => {
    if (!res.ok) throw new Error(`Wiktionary answered ${res.status}`)
    return res.json() as Promise<{
      query?: { pages?: { title?: string; missing?: boolean; extract?: string }[]; normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[] }
    }>
  })

/**
 * Sections of a Wiktionary page that a reader looking up a word does not need: etymology, pronunciation, translations,
 * phrases built on the word, references and links, in the languages the app offers (lower case)
 */
const SKIPPED_SECTIONS = new Set([
  'גיזרון', 'גזרון', 'צירופים', 'תרגום', 'ראו גם', 'קישורים חיצוניים', 'אסמכתאות', 'סימוכין', 'הערות שוליים', 'מידע נוסף', 'מקור', 'פרשנים מפרשים', 'מובאות נוספות', 'נגזרות',
  'etymology', 'pronunciation', 'translations', 'references', 'anagrams', 'further reading', 'descendants', 'see also', 'external links', 'derived terms', 'related terms', 'hyphenation', 'alternative forms', 'quotations', 'usage notes', 'coordinate terms', 'compounds',
  'étymologie', 'prononciation', 'traductions', 'références', 'anagrammes', 'voir aussi', 'liens externes', 'dérivés', 'apparentés étymologiques', 'vocabulaire apparenté par le sens', 'hyperonymes', 'hyponymes',
  'herkunft', 'aussprache', 'übersetzungen', 'referenzen und weiterführende informationen', 'quellen', 'worttrennung', 'wortbildungen', 'redewendungen', 'charakteristische wortkombinationen', 'beispiele',
  'etimología', 'pronunciación y escritura', 'pronunciación', 'traducciones', 'referencias', 'véase también', 'locuciones', 'información adicional',
  'этимология', 'произношение', 'перевод', 'библиография', 'литература', 'фразеологизмы и устойчивые сочетания', 'морфологические и синтаксические свойства', 'родственные слова', 'анаграммы',
  'التأصيل', 'النطق', 'ترجمة', 'الترجمة', 'مراجع', 'انظر أيضا',
])

/** a plain-text extract without the sections a reader does not need, its headings shown as plain lines */
export function cleanExtract(text: string): string {
  const out: string[] = []
  let skipBelow = 0
  for (const line of text.split('\n')) {
    const heading = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      if (skipBelow && level > skipBelow) continue
      skipBelow = SKIPPED_SECTIONS.has(heading[2]!.toLowerCase()) ? level : 0
      if (!skipBelow && heading[2]) out.push('', heading[2])
      continue
    }
    if (!skipBelow) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function extractOf(lang: string, title: string, signal?: AbortSignal): Promise<string | null> {
  const data = await api(lang, { action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', titles: title }, signal)
  const page = data.query?.pages?.[0]
  const extract = page && !page.missing ? cleanExtract(page.extract ?? '') : ''
  return extract ? (extract.length > MAX_CHARS ? extract.slice(0, MAX_CHARS).trimEnd() + '…' : extract) : null
}

/** the meanings on the Hebrew Wiktionary page `title`, read from its wikitext like the offline pack; null when it has none */
async function heMeaningsOf(title: string, asWritten: string, signal?: AbortSignal): Promise<Meaning[] | null> {
  const data = (await api('he', { action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: title }, signal)) as {
    query?: { pages?: { missing?: boolean; revisions?: { slots?: { main?: { content?: string } } }[] }[] }
  }
  const page = data.query?.pages?.[0]
  const text = page && !page.missing ? page.revisions?.[0]?.slots?.main?.content : undefined
  const meanings = text ? meaningsFromLines('he', parseHeWiktionaryPage(text), asWritten) : []
  return meanings.length ? meanings : null
}

/** the last words looked up online in Hebrew, as meanings */
const meaningCache = new Map<string, Meaning[] | null>()

/**
 * The online answer for `word`: in Hebrew, its meanings read from the Hebrew Wiktionary like those of the offline pack
 * (definitions and related words only, a list to pick from when there are several); in the other languages, the text of
 * the entry without etymology, translations and the like (`lookUpWord`). Null when there is no entry.
 */
export async function lookUpWordOnline(lang: string, word: string, signal?: AbortSignal): Promise<Meaning[] | string | null> {
  if (lang !== 'he') return lookUpWord(lang, word, signal)
  if (meaningCache.has(word)) return meaningCache.get(word)!
  const titles = [word, ...baseCandidates(lang, word).map((c) => c.word)].slice(0, 50)
  const title = await firstExisting(lang, titles, signal)
  const meanings = title ? await heMeaningsOf(title, word, signal) : null
  if (!meanings) return lookUpWord(lang, word, signal)
  if (meaningCache.size >= CACHE_MAX) meaningCache.delete(meaningCache.keys().next().value!)
  meaningCache.set(word, meanings)
  return meanings
}

/** the first of `titles` that has a page (one request for all of them, at most 50) */
async function firstExisting(lang: string, titles: string[], signal?: AbortSignal): Promise<string | null> {
  const data = await api(lang, { action: 'query', redirects: '1', titles: titles.join('|') }, signal)
  const follow = (list: { from: string; to: string }[] | undefined, title: string) => list?.find((l) => l.from === title)?.to ?? title
  const present = new Set((data.query?.pages ?? []).filter((p) => !p.missing && p.title).map((p) => p.title!))
  return titles.find((title) => present.has(follow(data.query?.redirects, follow(data.query?.normalized, title)))) ?? null
}

/**
 * Plain-text entry for `word` from the `lang` Wiktionary, or null when there is no such entry. A Hebrew or Arabic word
 * with no page of its own is tried without its prefixes and endings, and the entry of its likeliest base word is shown.
 * Rejects when the network or the service fails.
 */
export async function lookUpWord(lang: string, word: string, signal?: AbortSignal): Promise<string | null> {
  const key = `${lang}:${word}`
  if (cache.has(key)) return cache.get(key)!
  let text = await extractOf(lang, word, signal)
  const guesses = text ? [] : baseCandidates(lang, word).slice(0, 50).map((c) => c.word)
  if (guesses.length) {
    const base = await firstExisting(lang, guesses, signal)
    const extract = base ? await extractOf(lang, base, signal) : null
    if (base && extract) text = `${t('dict.formOf', { word: base })}\n\n${extract}`
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, text)
  return text
}
