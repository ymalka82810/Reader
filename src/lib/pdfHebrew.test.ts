import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// real PDFs (src/test/fixtures), read by the real pdf.js and the real extractor, as in the app; only the page rendering
// (cover, page pictures), which needs a browser canvas, is left out
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({
  default: pathToFileURL(resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href,
}))

const g = globalThis as { document?: unknown }
beforeAll(() => {
  // the cover and page pictures cannot be drawn without a canvas: pdfToBook logs that and carries on
  vi.spyOn(console, 'error').mockImplementation(() => {})
  g.document = {
    baseURI: pathToFileURL(resolve('.') + '/').href,
    createElement: () => {
      throw new Error('no canvas in tests')
    },
  }
})
afterAll(() => {
  vi.restoreAllMocks()
  delete g.document
})

const { extractPdf } = await import('./pdfToBook')

const convert = async (name: string) => {
  const file = new File([readFileSync(`src/test/fixtures/${name}.pdf`)], `${name}.pdf`, { type: 'application/pdf' })
  return extractPdf(file, file.name)
}

const OPENING = 'בראשית ברא אלוהים את השמיים ואת הארץ. והארץ הייתה תהו ובהו, וחושך על פני תהום'

describe('converting real Hebrew PDFs', () => {
  // the same text, stored three ways by different PDF producers
  for (const [name, how] of [
    ['hebrew-visual', 'whole lines in visual (reversed) order'],
    ['hebrew-words-visual', 'one run per word, with no space characters'],
    ['hebrew-logical-lines', 'whole lines in logical order'],
  ] as const) {
    it(`reads text stored as ${how}`, async () => {
      const x = await convert(name)
      expect(x.keepOriginal).toBe(false)
      expect(x.rtl).toBe(true)
      const paras = x.chapters.flatMap((c) => c.paras)
      expect(paras).toHaveLength(4) // two paragraphs on each of the two pages
      expect(paras[0]!.startsWith(OPENING)).toBe(true)
      // words that were run together would show up as very long "words"
      for (const p of paras) for (const w of p.split(' ')) expect(w.length, w).toBeLessThan(12)
    })
  }

  it('keeps a PDF with a table as the original file', async () => {
    const x = await convert('hebrew-table')
    expect(x.keepOriginal).toBe(true)
    expect(x.chapters).toHaveLength(0)
  })

  it('keeps a scanned PDF (pictures, no text) as the original file', async () => {
    const x = await convert('scan-only')
    expect(x.keepOriginal).toBe(true)
  })
})
