/** the last words looked up, so reopening one (or turning back to it) works without the network */
const cache = new Map<string, string | null>()
const CACHE_MAX = 50
/** a Wiktionary page can run to many languages; the popup only needs the start */
const MAX_CHARS = 4000

export const wiktionaryUrl = (lang: string, word: string) => `https://${lang}.wiktionary.org/wiki/${encodeURIComponent(word)}`

/** the first word of a selection, without the punctuation stuck to it */
export const firstWord = (text: string) =>
  text.trim().split(/\s+/)[0]?.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '') ?? ''

/**
 * Plain-text entry for `word` from the `lang` Wiktionary, or null when there is no such entry.
 * Rejects when the network or the service fails.
 */
export async function lookUpWord(lang: string, word: string, signal?: AbortSignal): Promise<string | null> {
  const key = `${lang}:${word}`
  if (cache.has(key)) return cache.get(key)!
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    redirects: '1',
    titles: word,
    format: 'json',
    formatversion: '2',
    origin: '*',
  })
  const res = await fetch(`https://${lang}.wiktionary.org/w/api.php?${params}`, { signal })
  if (!res.ok) throw new Error(`Wiktionary answered ${res.status}`)
  const data = (await res.json()) as { query?: { pages?: { missing?: boolean; extract?: string }[] } }
  const page = data.query?.pages?.[0]
  const extract = page && !page.missing ? page.extract?.trim() : ''
  const text = extract ? (extract.length > MAX_CHARS ? extract.slice(0, MAX_CHARS).trimEnd() + '…' : extract) : null
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, text)
  return text
}
