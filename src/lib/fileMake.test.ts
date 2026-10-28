import { expect, it } from 'vitest'
import { headStyle, makeOf, makeVerdict, pdfMake } from './fileMake'

const opf = `<package><metadata>
  <dc:contributor opf:role="bkp">calibre (5.3.0) [https://calibre-ebook.com]</dc:contributor>
  <meta name="generator" content="Sigil 1.9"/>
</metadata><manifest><item id="id12" href="text/part0001.html" media-type="application/xhtml+xml"/></manifest></package>`

it('reads a file’s make: its generator, style sheets, fonts, the shape of its parts and contents, its chapter heads', () => {
  const ncx = '<navMap><navPoint id="np_1"><navPoint id="np_2"></navPoint></navPoint></navMap>'
  const m = makeOf({ opf, css: ['p { margin: 0 } /* x */ h1{font-size:2em}'], fonts: ['fonts/Frank-Ruhl.ttf'], ncx, heads: ['פרק 1', 'פרק 2', 'פרק 3', 'שלום'] })
  expect(m).toEqual(expect.arrayContaining(['g:calibre 5.3.0', 'g:sigil 1.9', 'f:frank-ruhl', 'm:text/part#.html|id#', 't:np_#|2', 'h:word-digit']))
  expect(m.some((k) => k.startsWith('c:'))).toBe(true)
  // the same style sheet with other spaces and comments is the same one
  expect(makeOf({ opf: '', css: ['p{margin:0}h1 { font-size: 2em }'] })).toEqual(m.filter((k) => k.startsWith('c:')))
  expect(pdfMake({ Producer: 'Adobe PDF Library 15.0', Creator: 7 })).toEqual(['g:adobe pdf library 15.0'])
})

it('tells chapter heads apart', () => {
  expect(['פרק 1', 'Chapter IV', 'פרק ראשון', '12', 'XI', 'אחד', 'הבוקר שאחרי'].map(headStyle)).toEqual(['word-digit', 'word-roman', 'word-word', 'digit', 'roman', 'word', undefined])
})

it('agrees when the series’ books share with it what is rare in the library, and never speaks against', () => {
  const common = ['g:pdf2epub']
  const library = [...Array.from({ length: 20 }, () => common), ['c:aaaa', 'g:x'], ['c:aaaa', 'g:x']]
  expect(makeVerdict(['c:aaaa', ...common], [['c:aaaa'], ['c:aaaa', 'g:x']], library)).toBe('agree')
  // what half the library shares says nothing
  expect(makeVerdict(common, [common, common], library)).toBeUndefined()
  // one book of the series only
  expect(makeVerdict(['c:aaaa'], [['c:aaaa']], library)).toBeUndefined()
  // a small library: not enough to know what rare is
  expect(makeVerdict(['c:aaaa'], [['c:aaaa'], ['c:aaaa']], library.slice(-3))).toBeUndefined()
})
