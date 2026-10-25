import { t } from '../i18n'
import { baseCandidates } from './morphology'

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

async function extractOf(lang: string, title: string, signal?: AbortSignal): Promise<string | null> {
  const data = await api(lang, { action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', titles: title }, signal)
  const page = data.query?.pages?.[0]
  const extract = page && !page.missing ? page.extract?.trim() : ''
  return extract ? (extract.length > MAX_CHARS ? extract.slice(0, MAX_CHARS).trimEnd() + '…' : extract) : null
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
