// The line classifier's training and its check (see lineModel). Every benchmark case with opening lines gives tagged
// lines: each tagged by the name the case should get. The check is leave-one-out: each case's lines are tagged by a
// model trained on all the other cases, so the score says how the classifier does on a book it never met. The
// starting weights the app ships (lineModel/weights.json) are trained on all the cases: `npm run train:lines`.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { isJunkTitle } from './bookName'
import type { BenchCase } from './identifyBench'
import { FEATURES, lineFeatures, startWeights, tagLines, TAGS, trainStep, type LineContext, type Tag } from './lineModel'

const dir = fileURLToPath(new URL('./', import.meta.url))
const cases = JSON.parse(readFileSync(`${dir}identifyBench/cases.json`, 'utf8')) as BenchCase[]
const prior = startWeights(JSON.parse(readFileSync(`${dir}lineModel/prior.json`, 'utf8')))

/** below this share of lines tagged right on books it did not learn from, the classifier has got worse */
const FLOOR = 0.9
const EPOCHS = 40
const RATE = 0.1

type Example = { x: number[]; tag: Tag; id: string }

function examples(c: BenchCase): Example[] {
  const lines = c.input.opening ?? []
  // only a case that says the whole name: one that leaves the author or the title out cannot tell its lines apart
  if (!lines.length || !c.expect.title || c.expect.author === undefined) return []
  // the lines as the identification meets them: with the title and author the book came with
  const ctx: LineContext = { author: c.input.author, ...(!isJunkTitle(c.input.title) && { title: c.input.title }) }
  const xs = lineFeatures(lines, ctx)
  const tags = tagLines(lines, c.expect, c.expect.author ?? c.input.author, ctx)
  return xs.flatMap((x, i) => (tags[i] ? [{ x, tag: tags[i], id: c.id }] : []))
}

function train(data: Example[]) {
  let w = prior.map((r) => [...r])
  for (let e = 0; e < EPOCHS; e++) for (const d of data) w = trainStep(w, d.x, d.tag, RATE, prior)
  return w
}

const best = (w: number[][], x: number[]) => {
  const z = w.map((row) => row.reduce((s, wi, i) => s + wi * x[i]!, 0))
  return TAGS[z.indexOf(Math.max(...z))]!
}

const all = cases.flatMap(examples)

it(`tags the opening lines of books it did not learn from (leave-one-out over ${all.length} lines)`, () => {
  const ids = [...new Set(all.map((d) => d.id))]
  let right = 0
  let rightPrior = 0
  const wrong: string[] = []
  for (const id of ids) {
    const w = train(all.filter((d) => d.id !== id))
    for (const d of all.filter((d) => d.id === id)) {
      const got = best(w, d.x)
      if (got === d.tag) right++
      else wrong.push(`${id}: ${d.tag} → ${got}`)
      if (best(prior, d.x) === d.tag) rightPrior++
    }
  }
  const share = right / all.length
  if (process.env.LINES_TRAIN === '1' || process.env.BENCH_REPORT === '1') {
    console.log(`lines right: ${right}/${all.length} (${Math.round(share * 1000) / 10}%), hand-set weights alone ${rightPrior}/${all.length}`)
    for (const x of wrong) console.log(`✗ ${x}`)
  }
  expect(share).toBeGreaterThanOrEqual(FLOOR)
})

it.runIf(process.env.LINES_TRAIN === '1')('writes the starting weights, trained on every case', () => {
  const w = train(all)
  const table = Object.fromEntries(
    TAGS.map((t, k) => [t, Object.fromEntries(FEATURES.flatMap((f, i) => (Math.abs(w[k]![i]!) >= 0.005 ? [[f, Math.round(w[k]![i]! * 1000) / 1000]] : [])))]),
  )
  writeFileSync(`${dir}lineModel/weights.json`, `${JSON.stringify(table, null, 1)}\n`)
})
