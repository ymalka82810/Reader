import { beforeEach, describe, expect, it } from 'vitest'
import { classifyLines, keepOpening, learnLines, learnLinesOf, linesReport, readLines, tagLines } from './lineModel'

beforeEach(() => localStorage.clear())

describe('readLines', () => {
  it('reads the title and the author of a plain title page', () => {
    expect(readLines(['מרים כהן', 'הבית שעל הגבעה', 'מאנגלית: יעל לוי', 'הוצאת כנרת'], {}, true)).toEqual({ title: 'הבית שעל הגבעה', author: 'מרים כהן' })
  })

  it('takes neither a credit, an address nor a review as the name', () => {
    const r = readLines(['"ספר מרתק ומטלטל"', 'תרגום: דן לוי', "רח' הרצל 5, תל אביב 6100000"], {}, true)
    expect(r.title).toBeUndefined()
    expect(r.author).toBeUndefined()
  })

  it('keeps a Hebrew book Hebrew', () => {
    expect(readLines(['THE LAST HOUSE', 'כל הזכויות שמורות'], {}, true).title).toBeUndefined()
  })

  it('reads the series line with its number', () => {
    const r = readLines(['רוני שגיא', 'שער האבן', 'הספר הראשון', 'בסדרת ממלכות הצפון'], {}, true)
    expect(r).toMatchObject({ title: 'שער האבן', series: 'ממלכות הצפון', number: '1' })
  })

  it('does not take a part of the title as its author', () => {
    expect(readLines(['שלום עליכם', 'שלום עליכם והחברים'], { title: 'שלום עליכם והחברים' }, true).author).toBeUndefined()
  })
})

describe('readLines with the cover', () => {
  it('takes the largest line as the author when the library knows that author, and the other as the title', () => {
    const cover = { largest: 'מירה אלון', lines: ['מירה אלון', 'שביל הצפצפות'] }
    expect(readLines([], { cover, authors: ['מירה אלון'] }, true)).toEqual({ title: 'שביל הצפצפות', author: 'מירה אלון' })
  })

  it('lets the title page decide what a cover line is', () => {
    const cover = { largest: 'מירה אלון', lines: ['מירה אלון', 'שביל הצפצפות'] }
    expect(readLines(['שביל הצפצפות', 'מאת מירה אלון'], { cover }, true)).toEqual({ title: 'שביל הצפצפות', author: 'מירה אלון' })
  })
})

describe('tagLines', () => {
  it('tags each line by the name the book is known to have', () => {
    expect(tagLines(['מרים כהן', 'הבית שעל הגבעה', 'ספר שני', 'בסדרת ההרים', 'הוצאת כנרת'], { title: 'הבית שעל הגבעה', series: 'ההרים' }, 'מרים כהן')).toEqual([
      'author',
      'title',
      'number',
      'series',
      'noise',
    ])
  })

  it('leaves untagged a line that may be a name the answer leaves out', () => {
    expect(tagLines(['מרים כהן', 'הבית שעל הגבעה'], { title: 'הבית שעל הגבעה' }, '')[0]).toBeUndefined()
  })
})

describe('learning', () => {
  it('learns from the lines of a book whose name the user approved, once', () => {
    keepOpening('b1', ['יואב לוי', 'שמש של חורף', 'עריכה: דנה'])
    const before = classifyLines(['יואב לוי', 'שמש של חורף'])[1]!.p.title
    learnLinesOf('b1', { series: '', number: '', title: 'שמש של חורף' }, 'יואב לוי')
    expect(linesReport()).toBe(3)
    expect(classifyLines(['יואב לוי', 'שמש של חורף'])[1]!.p.title).toBeGreaterThan(before)
    learnLinesOf('b1', { series: '', number: '', title: 'שמש של חורף' }, 'יואב לוי')
    expect(linesReport()).toBe(3)
  })

  it('learns nothing from a name that says nothing', () => {
    learnLines(['יואב לוי', 'שמש של חורף'], { series: '', number: '', title: '1~2402 1' }, 'יואב לוי')
    expect(linesReport()).toBe(0)
  })
})
