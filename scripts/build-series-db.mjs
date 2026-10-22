// Builds public/series-he.json (see src/lib/seriesDb.ts) from Wikidata: every written work in a series (P179) whose
// series has a Hebrew name, with the work's Hebrew name (its own label, or the title of a Hebrew edition of it), its
// number in the series (P1545) and its author's Hebrew name. Run by the series-db workflow; needs network.
//   node scripts/build-series-db.mjs [out-file]
import { writeFileSync } from 'node:fs'

const OUT = process.argv[2] ?? 'public/series-he.json'
const ENDPOINT = 'https://query.wikidata.org/sparql'
const UA = 'ReaderSeriesDb/1.0 (https://github.com/ymalka82810/Reader)'
// literary work, written work, book, novel, novella, short story, comic book / manga volume, children's book
const TYPES = ['Q7725634', 'Q47461344', 'Q571', 'Q8261', 'Q149537', 'Q49084', 'Q1760610', 'Q21198342', 'Q131276']

const byLabel = (type) => `
SELECT ?work ?title ?series ?seriesLabel ?num ?authorLabel WHERE {
  ?work wdt:P31 wd:${type} ; p:P179 ?st .
  ?st ps:P179 ?series .
  OPTIONAL { ?st pq:P1545 ?num }
  ?series rdfs:label ?seriesLabel . FILTER(LANG(?seriesLabel) = "he")
  ?work rdfs:label ?title . FILTER(LANG(?title) = "he")
  OPTIONAL { ?work wdt:P50 ?author . ?author rdfs:label ?authorLabel . FILTER(LANG(?authorLabel) = "he") }
}`

// a translated book often has a Hebrew edition item (P629 "edition of", in Hebrew P407) while the work has no Hebrew label
const byEdition = (type) => `
SELECT ?work ?title ?series ?seriesLabel ?num ?authorLabel WHERE {
  ?work wdt:P31 wd:${type} ; p:P179 ?st .
  ?st ps:P179 ?series .
  OPTIONAL { ?st pq:P1545 ?num }
  ?series rdfs:label ?seriesLabel . FILTER(LANG(?seriesLabel) = "he")
  ?edition wdt:P629 ?work ; wdt:P407 wd:Q9288 .
  { ?edition wdt:P1476 ?title } UNION { ?edition rdfs:label ?title . FILTER(LANG(?title) = "he") }
  OPTIONAL { ?work wdt:P50 ?author . ?author rdfs:label ?authorLabel . FILTER(LANG(?authorLabel) = "he") }
}`

async function ask(query, tries = 4) {
  for (let i = 1; ; i++) {
    const r = await fetch(`${ENDPOINT}?${new URLSearchParams({ format: 'json', query })}`, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } })
    if (r.ok) return (await r.json()).results.bindings
    if (i >= tries) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
    await new Promise((res) => setTimeout(res, 15_000 * i))
  }
}

const hebrew = (s) => /[\u05D0-\u05EA]/u.test(s)
const id = (uri) => uri.slice(uri.lastIndexOf('/') + 1)
const series = new Map() // series id -> { name, authors: Map<name, count>, books: Map<number, Set<title>> }

let rows = 0
for (const type of TYPES)
  for (const q of [byLabel, byEdition]) {
    let found
    try {
      found = await ask(q(type))
    } catch (e) {
      console.warn(`${type} ${q.name}: ${e.message}`)
      continue
    }
    rows += found.length
    for (const r of found) {
      const title = r.title?.value?.trim()
      const num = r.num?.value?.trim()
      // only a whole number: "1", not "1.5" or "A"
      if (!title || !hebrew(title) || !num || !/^\d{1,3}$/.test(num)) continue
      const s = series.get(id(r.series.value)) ?? { name: r.seriesLabel.value.trim(), authors: new Map(), books: new Map() }
      const n = Number(num)
      if (!s.books.has(n)) s.books.set(n, new Set())
      s.books.get(n).add(title)
      const a = r.authorLabel?.value?.trim()
      if (a) s.authors.set(a, (s.authors.get(a) ?? 0) + 1)
      series.set(id(r.series.value), s)
    }
    console.log(`${type} ${q.name}: ${found.length} rows`)
  }

const out = []
for (const s of series.values()) {
  // a number with two Hebrew names (two editions named differently) keeps both: either may be the book's
  const books = [...s.books].sort((x, y) => x[0] - y[0]).flatMap(([n, titles]) => [...titles].map((t) => [String(n), t]))
  if (books.length < 2) continue
  const author = [...s.authors].sort((x, y) => y[1] - x[1])[0]?.[0]
  out.push({ s: s.name, ...(author && { a: author }), b: books })
}
out.sort((x, y) => x.s.localeCompare(y.s, 'he'))
if (!out.length) throw new Error(`nothing found (${rows} rows): the file is left as it is`)
writeFileSync(OUT, `${JSON.stringify(out)}\n`)
console.log(`${out.length} series, ${out.reduce((n, s) => n + s.b.length, 0)} books -> ${OUT}`)
