import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * foliate-js is pinned to a commit and typed by hand (src/foliate.d.ts), and foliateFixes.ts patches
 * its renderer. This test fails when either the pin or the files we depend on change, as a reminder
 * to re-check foliate.d.ts and foliateFixes.ts, then update the values below.
 */
const PINNED_COMMIT = '78914aef4466eb960965702401634c2cb348e9b1'
const FILE_HASHES: Record<string, string> = {
  'view.js': 'e0093af921feb03b',
  'paginator.js': '51cec81572d5d182',
  'epub.js': 'dfe347495039e9b5',
}

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url)).toString()

describe('foliate-js pin', () => {
  it('package.json still pins the reviewed commit', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.dependencies['foliate-js']).toContain(PINNED_COMMIT)
  })

  it('the foliate files we type and patch are unchanged', () => {
    const got: Record<string, string> = {}
    for (const f of Object.keys(FILE_HASHES)) {
      const text = read(`node_modules/foliate-js/${f}`).replaceAll('\r\n', '\n')
      got[f] = createHash('sha256').update(text).digest('hex').slice(0, 16)
    }
    expect(got).toEqual(FILE_HASHES)
  })
})
