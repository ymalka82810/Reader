// Builds the offline dictionary packs (see src/lib/offlineDict.ts) from the kaikki.org extraction of the English Wiktionary:
// for each language, every word of that language with its part of speech and its first definitions (in English), plus a
// map from inflected forms to their base word. A pack is a gzipped file of lines: a header, then one shard per line
// (src/lib/dictPackFormat.ts). Run by the dictionary-packs workflow; needs network and about 8 GB of memory for English.
//   node --max-old-space-size=8192 scripts/build-dictionary-packs.mjs <out-dir> [code ...]
import { execFileSync } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
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

// not readline: it also breaks lines at U+2028 and U+2029, which occur inside the JSON strings of some entries
async function* linesOf(file) {
  let rest = ''
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    const parts = (rest + chunk).split('\n')
    rest = parts.pop()
    yield* parts
  }
  if (rest) yield rest
}

async function build(code) {
  const name = LANGS[code]
  const url = `https://kaikki.org/dictionary/${name}/kaikki.org-dictionary-${name}.jsonl`
  // the files run to gigabytes and the server cuts connections now and then: curl retries and resumes where it stopped
  const raw = `${out}/${code}.jsonl`
  execFileSync('curl', ['-fsSL', '--retry', '10', '--retry-all-errors', '--retry-delay', '5', '-C', '-', '-o', raw, url], { stdio: 'inherit' })
  const entries = new Map()
  const forms = new Map()
  const relations = new Map()
  for await (const line of linesOf(raw)) if (line.trim()) addKaikkiLine(code, JSON.parse(line), entries, forms, relations)
  // a word with no entry of its own (a form) has nothing to show its relations under
  for (const w of relations.keys()) if (!entries.has(w)) relations.delete(w)
  let bytes = 0
  for (const [w, e] of entries) bytes += w.length + JSON.stringify(e).length + 4
  for (const [f, w] of forms) bytes += f.length + w.length + 6
  for (const [w, r] of relations) bytes += w.length + JSON.stringify(r).length + 4
  const shards = Math.max(1, Math.ceil(bytes / SHARD_BYTES))
  const parts = Array.from({ length: shards }, () => ({ e: {}, f: {}, r: {} }))
  for (const [w, e] of entries) parts[shardOf(w, shards)].e[w] = e
  for (const [f, w] of forms) parts[shardOf(f, shards)].f[f] = w
  for (const [w, r] of relations) parts[shardOf(w, shards)].r[w] = r
  await rm(raw)
  const header = { v: PACK_VERSION, lang: code, shards, words: entries.size, built: new Date().toISOString().slice(0, 10) }
  const file = `${out}/${code}.ndjson.gz`
  await pipeline(Readable.from([JSON.stringify(header), ...parts.map((p) => JSON.stringify(p))].map((l) => l + '\n')), createGzip({ level: 9 }), createWriteStream(file))
  const size = (await stat(file)).size
  console.log(`${code}: ${entries.size} words, ${forms.size} forms, ${relations.size} with related words, ${shards} shards, ${(size / 1e6).toFixed(1)} MB`)
  return { bytes: size, words: entries.size, built: header.built }
}

const manifest = {}
for (const code of wanted) manifest[code] = await build(code)
await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 1))
