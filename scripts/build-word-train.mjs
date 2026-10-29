// Builds scripts/data/word-train.json, extra training data for the word tagger (src/lib/wordModel.ts): written works with
// a Hebrew name and an author with a Hebrew name, whether or not they are in a series, with the year they were first
// published. It is read only by the tagger's training (src/lib/wordModel.train.test.ts) and is not shipped with the app.
// Run by the word-train workflow; needs network.
//   node scripts/build-word-train.mjs [out-file]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const OUT = process.argv[2] ?? 'scripts/data/word-train.json'
const ENDPOINT = 'https://query.wikidata.org/sparql'
const UA = 'ReaderWordTrain/1.0 (https://github.com/ymalka82810/Reader)'
// works with an article on the Hebrew Wikipedia (a small, indexed set), and works of the common kinds with a Hebrew name
const QUERIES = {
  hewiki: `
SELECT ?title ?authorLabel ?date WHERE {
  ?article schema:about ?work ; schema:isPartOf <https://he.wikipedia.org/> .
  ?work wdt:P50 ?author .
  ?work rdfs:label ?title . FILTER(LANG(?title) = "he")
  ?author rdfs:label ?authorLabel . FILTER(LANG(?authorLabel) = "he")
  OPTIONAL { ?work wdt:P577 ?date }
}`,
  ...Object.fromEntries(
    // novel, literary work, children's book
    ['Q8261', 'Q7725634', 'Q131276'].map((type) => [
      type,
      `
SELECT ?title ?authorLabel ?date WHERE {
  ?work wdt:P31 wd:${type} ; wdt:P50 ?author .
  ?work rdfs:label ?title . FILTER(LANG(?title) = "he")
  ?author rdfs:label ?authorLabel . FILTER(LANG(?authorLabel) = "he")
  OPTIONAL { ?work wdt:P577 ?date }
} LIMIT 20000`,
    ]),
  ),
}

async function ask(query, tries = 4) {
  for (let i = 1; ; i++) {
    const r = await fetch(`${ENDPOINT}?${new URLSearchParams({ format: 'json', query })}`, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } })
    if (r.ok) return (await r.json()).results.bindings
    if (i >= tries) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
    await new Promise((res) => setTimeout(res, 15_000 * i))
  }
}

const hebrew = (s) => /[\u05D0-\u05EA]/u.test(s)
const label = (s) => s.replace(/\s+\([^()]*\)\s*$/u, '').trim() || s.trim()
const books = new Map() // title|author -> [title, author, year?]
const report = {}
for (const [name, query] of Object.entries(QUERIES)) {
  let found
  try {
    found = await ask(query)
  } catch (e) {
    report[name] = String(e.message).slice(0, 300)
    continue
  }
  report[name] = found.length
  for (const r of found) {
    const title = label(r.title?.value ?? '')
    const author = label(r.authorLabel?.value ?? '')
    // a Hebrew title of a few words, by an author whose Hebrew name is a person's (two to four words)
    if (!title || !author || !hebrew(title) || !hebrew(author) || title.length > 70 || /\d{4}/.test(title)) continue
    if (author.split(/\s+/).length < 2 || author.split(/\s+/).length > 4) continue
    const year = Number(/^[+]?(\d{4})-/.exec(r.date?.value ?? '')?.[1])
    const key = `${title}|${author}`
    const had = books.get(key)
    if (!had) books.set(key, year >= 1500 && year <= 2100 ? [title, author, year] : [title, author])
    else if (year >= 1500 && year <= 2100 && !(had[2] <= year)) had[2] = year
  }
}

const out = [...books.values()].sort((x, y) => x[0].localeCompare(y[0], 'he'))
report.books = out.length
mkdirSync(dirname(OUT), { recursive: true })
// what each query found, kept beside the data so a run that found little can be told apart from one that failed
writeFileSync(OUT.replace(/\.json$/, '.report.json'), `${JSON.stringify(report, null, 1)}\n`)
if (out.length >= 100) writeFileSync(OUT, `${JSON.stringify(out)}\n`)
console.log(JSON.stringify(report))
