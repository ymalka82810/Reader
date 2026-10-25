// Builds the offline dictionary packs (see src/lib/offlineDict.ts): for each language, every word of that language with its
// part of speech and its first definitions, a map from inflected forms to their base word, and the words related to each.
// Definitions come from the language's own Wiktionary where there is an extraction of it (see addNative), and from the
// kaikki.org extraction of the English Wiktionary (definitions in English) for the rest. A pack is a gzipped file of lines: a header, then one shard per line
// (src/lib/dictPackFormat.ts). Run by the dictionary-packs workflow; needs network and about 8 GB of memory for English.
//   node --max-old-space-size=8192 scripts/build-dictionary-packs.mjs <out-dir> [code ...]
import { execFileSync, spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { addKaikkiLine, mergeTableForms, PACK_VERSION, shardOf } from '../src/lib/dictPackFormat.ts'
import { parseHeWiktionaryPage, readDumpPages } from '../src/lib/heWiktionary.ts'

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

/** downloads `url` to `file`; the files run to gigabytes and servers cut connections now and then: curl retries and resumes */
const fetchTo = (url, file) =>
  execFileSync('curl', ['-fsSL', '--retry', '10', '--retry-all-errors', '--retry-delay', '5', '-C', '-', '-o', file, url], { stdio: 'inherit' })

/** the lines of a stream of text */
async function* streamLines(stream) {
  let rest = ''
  for await (const chunk of stream) {
    const parts = (rest + chunk).split('\n')
    rest = parts.pop()
    yield* parts
  }
  if (rest) yield rest
}

/**
 * Definitions in the language itself, from that language's own Wiktionary: kaikki.org extracts the French, German,
 * Spanish and Russian editions (all languages in one file, so the lines of this one are picked out); the Hebrew edition
 * is read from its Wikimedia dump. Returns false for a language with no such source.
 */
async function addNative(code, entries, forms, relations, tableForms) {
  if (['fr', 'de', 'es', 'ru'].includes(code)) {
    const file = `${out}/${code}-native.jsonl.gz`
    fetchTo(`https://kaikki.org/${code}wiktionary/raw-wiktextract-data.jsonl.gz`, file)
    const mark = new RegExp(`"lang_code": ?"${code}"`)
    const text = createReadStream(file).pipe(createGunzip())
    text.setEncoding('utf8')
    for await (const line of streamLines(text)) {
      // translations carry a lang_code too: only a line about a word of this language counts
      if (!mark.test(line)) continue
      const data = JSON.parse(line)
      if (data.lang_code === code) addKaikkiLine(code, data, entries, forms, relations, tableForms)
    }
    await rm(file)
    return true
  }
  if (code === 'he') {
    const file = `${out}/hewiktionary.xml.bz2`
    fetchTo('https://dumps.wikimedia.org/hewiktionary/latest/hewiktionary-latest-pages-articles.xml.bz2', file)
    const bzcat = spawn('bzcat', [file], { stdio: ['ignore', 'pipe', 'inherit'] })
    bzcat.stdout.setEncoding('utf8')
    await readDumpPages(streamLines(bzcat.stdout), (_title, text) => {
      for (const line of parseHeWiktionaryPage(text)) addKaikkiLine(code, line, entries, forms, relations, tableForms)
    })
    await rm(file)
    return true
  }
  return false
}

async function build(code) {
  const name = LANGS[code]
  const forms = new Map()
  const relations = new Map()
  const tableForms = new Map()
  // the language's own definitions come first; the English Wiktionary's fill in the words they lack
  const native = new Map()
  const hasNative = await addNative(code, native, forms, relations, tableForms)
  const raw = `${out}/${code}.jsonl`
  fetchTo(`https://kaikki.org/dictionary/${name}/kaikki.org-dictionary-${name}.jsonl`, raw)
  const entries = new Map()
  for await (const line of linesOf(raw)) if (line.trim()) addKaikkiLine(code, JSON.parse(line), entries, forms, relations, tableForms)
  await rm(raw)
  const english = entries.size
  for (const [w, e] of native) entries.set(w, e)
  mergeTableForms(forms, tableForms, entries)
  // a word with no entry of its own (a form) has nothing to show its relations under
  for (const w of relations.keys()) if (!entries.has(w)) relations.delete(w)
  if (hasNative) console.log(`${code}: ${native.size} words from its own Wiktionary, ${english} from the English one`)
  let bytes = 0
  for (const [w, e] of entries) bytes += w.length + JSON.stringify(e).length + 4
  for (const [f, w] of forms) bytes += f.length + w.length + 6
  for (const [w, r] of relations) bytes += w.length + JSON.stringify(r).length + 4
  const shards = Math.max(1, Math.ceil(bytes / SHARD_BYTES))
  const parts = Array.from({ length: shards }, () => ({ e: {}, f: {}, r: {} }))
  for (const [w, e] of entries) parts[shardOf(w, shards)].e[w] = e
  for (const [f, w] of forms) parts[shardOf(f, shards)].f[f] = w
  for (const [w, r] of relations) parts[shardOf(w, shards)].r[w] = r
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
