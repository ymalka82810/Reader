import { createStore, del, delMany, get, keys, set, setMany } from 'idb-keyval'
import { t } from '../i18n'
import { baseCandidates } from './morphology'
import { addKaikkiLine, normalizeWord, PACK_VERSION, shardOf, type KaikkiLine, type PackEntry, type PackHeader, type RelationKind, type Shard } from './dictPackFormat'

/** where the packs live: a branch the dictionary-packs workflow rebuilds (raw.githubusercontent.com is allowed by the content-security policy) */
const PACKS_URL = 'https://raw.githubusercontent.com/ymalka82810/Reader/dictionary-packs'
const packUrl = (lang: string) => `${PACKS_URL}/${lang}.ndjson.gz`

/** what is known about a pack before downloading it */
export type PackInfo = { bytes: number; words: number; built: string }
/** a downloaded pack */
export type InstalledPack = PackInfo & { shards: number }

// shards are stored under `<lang>:<n>`, a finished pack's description under `meta:<lang>` (written last, so a half-downloaded pack is not "installed")
const store = createStore('reader-dict-db', 'packs')
const metaKey = (lang: string) => `meta:${lang}`
const shardKey = (lang: string, i: number) => `${lang}:${i}`

/** the sizes of the packs on offer; null when the network or the host fails */
export async function fetchPackList(signal?: AbortSignal): Promise<Record<string, PackInfo> | null> {
  try {
    const res = await fetch(`${PACKS_URL}/manifest.json`, { signal, cache: 'no-cache' })
    return res.ok ? ((await res.json()) as Record<string, PackInfo>) : null
  } catch {
    return null
  }
}

export async function installedPacks(): Promise<Record<string, InstalledPack>> {
  const all: Record<string, InstalledPack> = {}
  for (const k of await keys<string>(store)) {
    if (!k.startsWith('meta:')) continue
    const meta = await get<InstalledPack>(k, store)
    if (meta) all[k.slice(5)] = meta
  }
  return all
}

/** drops a pack and any shards of it that an interrupted download left behind */
export async function removePack(lang: string) {
  shardCache.clear()
  await del(metaKey(lang), store)
  await delMany((await keys<string>(store)).filter((k) => k.startsWith(`${lang}:`)), store)
}

/** lines of text out of a stream of bytes that may be gzip */
async function* textLines(body: ReadableStream<Uint8Array<ArrayBuffer>>, gzipped: boolean) {
  const text = (gzipped ? body.pipeThrough(new DecompressionStream('gzip')) : body).pipeThrough(new TextDecoderStream())
  const reader = text.getReader()
  let rest = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const parts = (rest + value).split('\n')
    rest = parts.pop()!
    yield* parts
  }
  if (rest) yield rest
}

/**
 * Downloads the pack of `lang` into the device. `onProgress` gets the share (0 to 1) of the download that has arrived.
 * Rejects when the network fails, the file is not a pack of this version, or `signal` aborts; a failed download leaves nothing behind.
 */
export async function downloadPack(lang: string, expectedBytes: number, onProgress: (share: number) => void, signal?: AbortSignal) {
  const res = await fetch(packUrl(lang), { signal })
  if (!res.ok || !res.body) throw new Error(`The dictionary host answered ${res.status}`)
  const total = Number(res.headers.get('content-length')) || expectedBytes
  let received = 0
  const counted = res.body.pipeThrough(
    new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
      transform(chunk, ctl) {
        received += chunk.length
        if (total) onProgress(Math.min(1, received / total))
        ctl.enqueue(chunk)
      },
    }),
  )
  // some hosts and proxies already undo the compression, and then the bytes that arrive are plain text
  const gzipped = !/gzip/i.test(res.headers.get('content-encoding') ?? '')
  await removePack(lang)
  try {
    let header: PackHeader | undefined
    let batch: [string, Shard][] = []
    let written = 0
    const flush = async () => {
      await setMany(batch, store)
      batch = []
    }
    for await (const line of textLines(counted, gzipped)) {
      if (!header) {
        header = JSON.parse(line) as PackHeader
        if (header.v !== PACK_VERSION || header.lang !== lang || !(header.shards > 0)) throw new Error('Not a dictionary pack this version can read')
        continue
      }
      batch.push([shardKey(lang, written++), JSON.parse(line) as Shard])
      if (batch.length >= 40) await flush()
    }
    await flush()
    if (!header || written !== header.shards) throw new Error('The dictionary download is incomplete')
    await set(metaKey(lang), { bytes: received, words: header.words, built: header.built, shards: header.shards } satisfies InstalledPack, store)
    onProgress(1)
  } catch (e) {
    await removePack(lang)
    throw e
  }
}

/** a few shards stay in memory: a reader tends to look up words one after another */
const shardCache = new Map<string, Shard | undefined>()
const SHARD_CACHE_MAX = 16

async function shardFor(lang: string, shards: number, key: string): Promise<Shard | undefined> {
  const k = shardKey(lang, shardOf(key, shards))
  if (shardCache.has(k)) return shardCache.get(k)
  const shard = await get<Shard>(k, store)
  if (shardCache.size >= SHARD_CACHE_MAX) shardCache.delete(shardCache.keys().next().value!)
  shardCache.set(k, shard)
  return shard
}

const own = <T>(o: Record<string, T> | undefined, k: string): T | undefined => (o && Object.hasOwn(o, k) ? o[k] : undefined)

/** the entries of `key` in its shard, whichever version of the format the pack on the device has */
function entriesIn(shard: Shard | undefined, key: string): PackEntry[] | undefined {
  const list = own(shard?.e, key)
  const legacyRelated = own(shard?.r, key)
  return list?.map((e) => (Array.isArray(e) ? { p: e[0], g: e.slice(1), ...(legacyRelated && { r: legacyRelated }) } : e))
}

type Found = { word: string; entries: PackEntry[] }

/** the entries a key has in the pack: its own, and those of the base word it is a form of; empty when it has neither */
async function entriesOf(lang: string, shards: number, key: string): Promise<Found[]> {
  const shard = await shardFor(lang, shards, key)
  const out: Found[] = []
  const direct = entriesIn(shard, key)
  if (direct) out.push({ word: key, entries: direct })
  const base = own(shard?.f, key)
  const baseEntries = base ? entriesIn(await shardFor(lang, shards, base), base) : undefined
  if (base && baseEntries) out.push({ word: base, entries: baseEntries })
  return out
}

/** at most this many base words for a word that is not in the pack as written */
const MAX_READINGS = 3
const RELATION_ORDER: RelationKind[] = ['s', 'a', 'r', 'd']

/**
 * One meaning of the word looked up, as shown: `word` is the dictionary word it belongs to, `formOf` says the word looked
 * up is a form of that word (or the word without its prefixes and endings), `headword` is how the dictionary writes it in
 * full (with niqqud, when it has them), and `related` holds its synonyms, antonyms, related and derived words.
 */
export type Meaning = {
  word: string
  formOf: boolean
  headword: string
  pos: string
  glosses: string[]
  related: { kind: RelationKind; words: string[] }[]
}

const toMeanings = (found: Found[], asWritten: string): Meaning[] =>
  found.flatMap(({ word, entries }) =>
    entries.map((e) => ({
      word,
      formOf: word !== asWritten,
      headword: e.h ?? word,
      pos: e.p,
      glosses: e.g,
      related: RELATION_ORDER.map((kind) => ({ kind, words: (e.r?.[kind] ?? []).filter((w) => w !== word) })).filter((r) => r.words.length),
    })),
  )

/**
 * The meanings of `word` in the downloaded pack of `lang`; null when that pack is not on the device or has no such word.
 * An inflected form gives the meanings of its base word. A Hebrew or Arabic word that is not in the pack as written
 * ("וכשהלכתי", "وبكتابها") is looked up without its prefixes and endings, giving the meanings of its likeliest readings.
 */
export async function lookUpOfflineMeanings(lang: string, word: string): Promise<Meaning[] | null> {
  const meta = await get<InstalledPack>(metaKey(lang), store)
  if (!meta) return null
  for (const w of new Set([word, word.toLowerCase()])) {
    const key = normalizeWord(lang, w)
    const found = await entriesOf(lang, meta.shards, key)
    if (found.length) return toMeanings(found, key)
  }
  const readings: Found[] = []
  let tier = Infinity
  for (const { word: guess, cost } of baseCandidates(lang, word)) {
    // only the guesses that took as few changes as the first one that matched: further ones are mostly noise
    if (cost > tier || readings.length >= MAX_READINGS) break
    for (const f of await entriesOf(lang, meta.shards, guess)) {
      if (readings.length >= MAX_READINGS || readings.some((r) => r.word === f.word)) continue
      readings.push(f)
      tier = cost
    }
  }
  return readings.length ? toMeanings(readings, '') : null
}

/** the meanings in some lines of a Wiktionary page (read as kaikki lines), for the word `asWritten` was looked up as */
export function meaningsFromLines(lang: string, lines: KaikkiLine[], asWritten: string): Meaning[] {
  const entries = new Map<string, PackEntry[]>()
  for (const line of lines) addKaikkiLine(lang, line, entries, new Map())
  return toMeanings([...entries].map(([word, list]) => ({ word, entries: list })), normalizeWord(lang, asWritten))
}

const definitions = (m: Meaning) => `${m.pos}\n${m.glosses.map((g, i) => `${i + 1}. ${g}`).join('\n')}`

/** one meaning as plain text, as it is kept for review */
export const meaningText = (m: Meaning) => (m.formOf ? `${t('dict.formOf', { word: m.headword })}\n\n${definitions(m)}` : definitions(m))

/** all the meanings of `word` as plain text; a base word is named once above its meanings */
export async function lookUpOffline(lang: string, word: string): Promise<string | null> {
  const meanings = await lookUpOfflineMeanings(lang, word)
  if (!meanings) return null
  return meanings
    .map((m, i) => (m.formOf && meanings[i - 1]?.word !== m.word ? `${t('dict.formOf', { word: m.word })}\n\n${definitions(m)}` : definitions(m)))
    .join('\n\n')
}
