// The identification's benchmark (see identifyBench): no part of the name may score below the baseline. A change that
// raises a score raises the baseline with it: `npm run bench -- --update` writes the new one.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, it } from 'vitest'
import { FIELDS, percentages, runBench, type BenchCase } from './identifyBench'

const dir = fileURLToPath(new URL('./identifyBench/', import.meta.url))
const cases = JSON.parse(readFileSync(`${dir}cases.json`, 'utf8')) as BenchCase[]
const baselinePath = `${dir}baseline.json`
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, number>
const update = process.env.BENCH_UPDATE === '1'

afterAll(() => localStorage.clear())

it(`identifies the benchmark's ${cases.length} books at least as well as the baseline`, async () => {
  const r = await runBench(cases)
  const now = percentages(r)
  if (process.env.BENCH_REPORT === '1' || update) {
    console.log(['', ...[...FIELDS, 'whole'].map((f) => `${f.padEnd(7)} ${String(now[f as keyof typeof now]).padStart(5)}%  (baseline ${baseline[f]}%)`)].join('\n'))
    for (const f of r.failures) console.log(`✗ ${f.id} — ${f.field}: want "${f.want}", got "${f.got}"`)
  }
  if (update) writeFileSync(baselinePath, `${JSON.stringify(now, null, 1)}\n`)
  for (const f of [...FIELDS, 'whole'] as const) expect(now[f], `${f} fell below the baseline`).toBeGreaterThanOrEqual(baseline[f] ?? 0)
}, 60_000)
