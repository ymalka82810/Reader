// Builds scripts/data/word-train.json, extra training data for the word tagger (src/lib/wordModel.ts): written works with
// a Hebrew name and an author with a Hebrew name, whether or not they are in a series, with the year they were first
// published. It is read only by the tagger's training (src/lib/wordModel.train.test.ts) and is not shipped with the app.
// Run by the word-train workflow; needs network.
//   node scripts/build-word-train.mjs [out-file]
import { writeFileSync } from 'node:fs'

const OUT = process.argv[2] ?? 'scripts/data/word-train.json'
const ENDPOINT = 'https://query.wikidata.org/sparql'
const UA = 'ReaderWordTrain/1.0 (https://github.com/ymalka82810/Reader)'
// literary work, written work, book, novel, novella, children's book, short story collection
const TYPES = ['Q7725634', 'Q47461344', 'Q571', 'Q8261', 'Q149537', 'Q131276', 'Q1279564']

const byLabel = (type) => `
SELECT ?work ?title ?authorLabel ?date WHERE {
  ?work wdt:P31 wd:${type} ; wdt:P50 ?author .
  ?work rdfs:label ?title . FILTER(LANG(?title) = "he")
  ?author rdfs:label ?authorLabel . FILTER(LANG(?authorLabel) = "he")
  OPTIONAL { ?work wdt:P577 ?date }
} LIMIT 30000`

const byEdition = (type) => `
SELECT ?work ?title ?authorLabel ?date WHERE {
  ?work wdt:P31 wd:${type} ; wdt:P50 ?author .
  ?edition wdt:P629 ?work ; wdt:P407 wd:Q9288 .
  { ?edition wdt:P1476 ?title } UNION { ?edition rdfs:label ?title . FILTER(LANG(?title) = "he") }
  ?author rdfs:label ?authorLabel . FILTER(LANG(?authorLabel) = "he")
  OPTIONAL { ?work wdt:P577 ?date }
} LIMIT 30000`

async function ask(query, tries = 4) {
  for (let i = 1; ; i++) {
    const r = await fetch(`${ENDPOINT}?${new URLSearchParams({ format: 'json', query })}`, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } })
    if (r.ok) return (await r.json()).results.bindings
    if (i >= tries) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
    await new Promise((res) => setTimeout(res, 15_000 * i))
  }
}

const hebrew = (s) => /[\u05D0-\u05EA]/u.test(s)
const books = new Map() // title|author -> [title, author, year?]
for (const type of TYPES)
  for (const q of [byLabel, byEdition]) {
    let found
    try {
      found = await ask(q(type))
    } catch (e) {
      console.warn(`${type} ${q.name}: ${e.message}`)
      continue
    }
    for (const r of found) {
      const title = r.title?.value?.trim()
      const author = r.authorLabel?.value?.trim()
      // a Hebrew title of a few words, by an author whose Hebrew name is a person's (two to four words)
      if (!title || !author || !hebrew(title) || !hebrew(author) || title.length > 70 || /\d{4}/.test(title)) continue
      if (author.split(/\s+/).length < 2 || author.split(/\s+/).length > 4) continue
      const year = Number(/^[+]?(\d{4})-/.exec(r.date?.value ?? '')?.[1])
      const key = `${title}|${author}`
      const had = books.get(key)
      if (!had) books.set(key, year >= 1500 && year <= 2100 ? [title, author, year] : [title, author])
      else if (year >= 1500 && year <= 2100 && !(had[2] <= year)) had[2] = year
    }
    console.log(`${type} ${q.name}: ${found.length} rows`)
  }

const out = [...books.values()].sort((x, y) => x[0].localeCompare(y[0], 'he'))
if (out.length < 100) throw new Error(`only ${out.length} books found: the file is left as it is`)
writeFileSync(OUT, `${JSON.stringify(out)}\n`)
console.log(`${out.length} books -> ${OUT}`)
