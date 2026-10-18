/** the last passages translated, so reopening one works without the network */
const cache = new Map<string, string>()
const CACHE_MAX = 50
/** MyMemory takes about 500 bytes per request, so a passage goes out in pieces of this size */
const CHUNK_CHARS = 400
/** a longer selection is cut off: the popup is for a quick gloss, not for translating a chapter */
export const MAX_TRANSLATE_CHARS = 2000

/** split at sentence ends (then spaces) into pieces of at most `max` characters, keeping all the text */
export function chunkText(text: string, max = CHUNK_CHARS): string[] {
  const chunks: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    const head = rest.slice(0, max)
    const ends = [...head.matchAll(/[.!?…。؟]["')»”]?\s/gu)]
    const last = ends[ends.length - 1]
    const at = last ? last.index + last[0].length : head.lastIndexOf(' ') + 1 || max
    chunks.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

type Reply = { responseStatus: number | string; responseData?: { translatedText?: string } }

/** the free anonymous daily allowance of MyMemory is used up */
export class QuotaError extends Error {
  constructor() {
    super('MyMemory daily quota reached')
    this.name = 'QuotaError'
  }
}

async function translateChunk(text: string, pair: string, signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams({ q: text, langpair: pair })
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, { signal })
  if (res.status === 429) throw new QuotaError()
  if (!res.ok) throw new Error(`MyMemory answered ${res.status}`)
  const data = (await res.json()) as Reply
  const out = data.responseData?.translatedText
  const status = Number(data.responseStatus)
  // MyMemory reports the exhausted quota in the body (status 429, or a 200 carrying a warning text)
  if (status === 429 || /USED ALL AVAILABLE FREE TRANSLATIONS/i.test(out ?? '')) throw new QuotaError()
  if (status !== 200 || !out) throw new Error(`MyMemory status ${data.responseStatus}`)
  return out
}

/** Google's keyless endpoint (unofficial, so it can change): the fallback when MyMemory fails or runs out */
async function googleChunk(text: string, source: string, target: string, signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams({ client: 'gtx', sl: source || 'auto', tl: target, dt: 't', q: text })
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`, { signal })
  if (!res.ok) throw new Error(`Google answered ${res.status}`)
  const data = (await res.json()) as unknown
  const rows = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as unknown[]) : []
  const out = rows.map((r) => (Array.isArray(r) && typeof r[0] === 'string' ? r[0] : '')).join('')
  if (!out) throw new Error('Google returned no translation')
  return out
}

/** set once MyMemory's daily quota is hit and Google answered instead, so later passages skip the doomed request */
let myMemoryExhausted = false

/** MyMemory first; if it fails or is out of quota, Google. When both fail, the MyMemory error is the one reported. */
async function translateChunkWithFallback(
  text: string,
  pair: string,
  source: string,
  target: string,
  signal?: AbortSignal,
): Promise<string> {
  let first: unknown
  if (!myMemoryExhausted) {
    try {
      return await translateChunk(text, pair, signal)
    } catch (e) {
      if (signal?.aborted) throw e
      first = e
    }
  }
  try {
    const out = await googleChunk(text, source, target, signal)
    if (first instanceof QuotaError) myMemoryExhausted = true
    return out
  } catch (e) {
    if (signal?.aborted) throw e
    throw first ?? e
  }
}

/**
 * `text` translated into `target` (a language code such as 'he'). `source` is the language of the text,
 * or empty to have it detected. Rejects when the network or both services fail.
 */
export async function translateText(text: string, source: string, target: string, signal?: AbortSignal): Promise<string> {
  const from = source && source !== target ? source : 'Autodetect'
  const pair = `${from}|${target}`
  const key = `${pair}:${text}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const out: string[] = []
  for (const part of chunkText(text.slice(0, MAX_TRANSLATE_CHARS))) out.push(await translateChunkWithFallback(part, pair, from === 'Autodetect' ? '' : from, target, signal))
  const translated = out.join(' ')
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, translated)
  return translated
}
