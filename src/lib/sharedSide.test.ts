import { describe, expect, it } from 'vitest'
import { identifyBook, libraryNames } from './bookLookup'

// names as they stand in a real library: two words on both sides of the dash, so one name alone cannot say which is the author
const names = ['סטפני מאייר - מולד הירח', 'סטפני מאייר - ליקוי חמה', 'יונה ספיר - דם קר', 'יונה ספיר - המצולע', 'אליס אוזמן - עוצר נשימה 3', 'אליס אוזמן - עוצר נשימה 4']
const library = () => libraryNames(names.map((title, i) => ({ title, id: String(i) })))

describe('the side of "A - B" that books share is their author', () => {
  it.each([
    ['סטפני מאייר - מולד הירח', 'סטפני מאייר', 'מולד הירח'],
    ['יונה ספיר - דם קר', 'יונה ספיר', 'דם קר'],
    ['יונה ספיר - המצולע', 'יונה ספיר', 'המצולע'],
  ])('%s', async (title, author, rest) => {
    const r = await identifyBook({ title, author: '', fileName: 'x.pdf' }, false, undefined, [], undefined, library())
    expect(r).toMatchObject({ author, title: rest })
    expect(r.sure).toBeUndefined() // the user is asked, not told
  })
  it('does not make an author of a side that only one book has', () => {
    expect(libraryNames([{ title: 'שרה כהן - דנה לוי' }]).authors).toEqual([])
  })
})
