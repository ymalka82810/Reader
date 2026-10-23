// Builds the offline dictionary packs (see src/lib/offlineDict.ts) from the kaikki.org extraction of the English Wiktionary:
// for each language, every word of that language with its part of speech and its first definitions (in English), plus a
// map from inflected forms to their base word. A pack is a gzipped file of lines: a header, then one shard per line
// (src/lib/dictPackFormat.ts). Run by the dictionary-packs workflow; needs network and about 8 GB of memory for English.
//   node --max-old-space-size=8192 scripts/build-dictionary-packs.mjs <out-dir> [code ...]
import { createWriteStream } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { addKaikkiLine, PACK_VERSION, shardOf } from '../src/lib/dictPackFormat.ts'

// language code (the app's DICT_LANGS) -> name in kaikki.org's URLs
const LANGS = { he: 'Hebrew', en: 'English', ar: 'Arabic', ru: 'Russian', fr: 'French', de: 'German', es: 'Spanish' }
/** aim for shards of about this much JSON, so one lookup parses a small piece */
const SHARD_BYTES = 150_000

const [out, ...codes] = process.argv.slice(2)
if (!out) throw new Error('usage: build-dictionary-packs.mjs <out-dir> [code ...]')
await mkdir(out, { recursive: true })
const wanted = codes.length ? codes : Object.keys(LANGS)
const unknown = wanted.filter((c) => !(c in LANGS))
if (unknown.length) throw new Error(`unknown language: ${unknown.join(', ')}`)

async function build(code) {
  const name = LANGS[code]
  const url = `https://kaikki.org/dictionary/${name}/kaikki.org-dictionary-${name}.jsonl`
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`)
  const entries = new Map()
  const forms = new Map()
  const lines = createInterface({ input: Readable.fromWeb(res.body), crlfDelay: Infinity })
  for await (const line of lines) if (line) addKaikkiLine(code, JSON.parse(line), entries, forms)
  let bytes = 0
  for (const [w, e] of entries) bytes += w.length + JSON.stringify(e).length + 4
  for (const [f, w] of forms) bytes += f.length + w.length + 6
  const shards = Math.max(1, Math.ceil(bytes / SHARD_BYTES))
  const parts = Array.from({ length: shards }, () => ({ e: {}, f: {} }))
  for (const [w, e] of entries) parts[shardOf(w, shards)].e[w] = e
  for (const [f, w] of forms) parts[shardOf(f, shards)].f[f] = w
  const header = { v: PACK_VERSION, lang: code, shards, words: entries.size, built: new Date().toISOString().slice(0, 10) }
  const file = `${out}/${code}.ndjson.gz`
  await pipeline(Readable.from([JSON.stringify(header), ...parts.map((p) => JSON.stringify(p))].map((l) => l + '\n')), createGzip({ level: 9 }), createWriteStream(file))
  const size = (await stat(file)).size
  console.log(`${code}: ${entries.size} words, ${forms.size} forms, ${shards} shards, ${(size / 1e6).toFixed(1)} MB`)
  return { bytes: size, words: entries.size, built: header.built }
}

const manifest = {}
for (const code of wanted) manifest[code] = await build(code)
await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 1))
