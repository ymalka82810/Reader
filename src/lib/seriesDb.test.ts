import { afterEach, expect, it } from 'vitest'
import { identifyBook } from './bookLookup'
import { formatBookName } from './bookName'
import { bundledLists, setSeriesDb } from './seriesDb'

afterEach(() => {
  setSeriesDb([])
  localStorage.clear()
})

const db = () =>
  setSeriesDb([
    { s: 'מגיסטריום', a: 'הולי בלק וקסנדרה קלייר', b: [['1', 'מבחן הברזל'], ['2', 'הכפפה הנחושתית'], ['5', 'מגדל הזהב']] },
    { s: "פרסי ג'קסון והאולימפיים", a: 'ריק ריירדן', b: [['1', 'גנב הברק'], ['2', 'ים המפלצות']] },
    { s: 'סדרה אחרת', a: 'מישהו', b: [['3', 'הבחירה'], ['4', 'הדרך']] },
  ])

it('identifies a book of a series that comes with the app by its title, offline and with no library', async () => {
  db()
  const r = await identifyBook({ title: 'ים המפלצות', author: 'Rick Riordan', fileName: 'x.epub' }, false)
  expect(r).toMatchObject({ series: "פרסי ג'קסון והאולימפיים", number: '2', title: 'ים המפלצות' })
})

it('finds the original series of a copyright page by its sound, and the title by the number', async () => {
  db()
  const opening = ['Holly Black and Cassandra Clare', 'THE GOLDEN TOWER', 'MAGISTERIUM V', 'Copyright © 2018 by Holly Black and Cassandra Clare LLC']
  const r = await identifyBook({ title: '1~___#5_', author: 'הולי בלק וקסנדרה קלייר', fileName: '__5____1.pdf' }, false, undefined, opening)
  expect(formatBookName(r)).toBe('מגיסטריום 5 - מגדל הזהב')
  expect(r.sure).toBeUndefined()
})

it("looks up a one-word title only with its author, and another author's series not at all", () => {
  db()
  expect(bundledLists('', 'הבחירה')).toEqual([])
  expect(bundledLists('', 'ים המפלצות').length).toBe(3)
  expect(bundledLists('ריק ריירדן').map((l) => l.series)).toEqual(["פרסי ג'קסון והאולימפיים"])
  expect(bundledLists('Rick Riordan').map((l) => l.series)).toEqual(["פרסי ג'קסון והאולימפיים"])
})
