import { afterEach, describe, expect, it } from 'vitest'
import { identifyBook } from './bookLookup'
import { setSeriesDb } from './seriesDb'

afterEach(() => setSeriesDb([]))

describe('a number in the middle of a title', () => {
  const db = () =>
    setSeriesDb([
      { s: 'סדרת ספרי הארי פוטר', a: "ג'יי קיי רולינג", b: [['1', 'הארי פוטר ואבן החכמים'], ['2', 'הארי פוטר וחדר הסודות']] },
    ])
  it('is the number of the book a list names, and leaves the title as the list has it', async () => {
    db()
    const r = await identifyBook({ title: 'הארי פוטר 1 ואבן החכמים', author: '', fileName: 'x.pdf' }, false)
    expect(r).toMatchObject({ number: '1', title: 'הארי פוטר ואבן החכמים' })
    expect(r.series).toBeTruthy()
  })
  it('is left alone when the list gives that title another number', async () => {
    db()
    const r = await identifyBook({ title: 'הארי פוטר 2 ואבן החכמים', author: '', fileName: 'x.pdf' }, false)
    expect(r.series).toBe('')
  })
  it('is left alone when no list names the title', async () => {
    db()
    const r = await identifyBook({ title: 'בני הנפילים 1 עיר של עצמות', author: '', fileName: 'x.pdf' }, false)
    expect(r.series).toBe('')
  })
})
