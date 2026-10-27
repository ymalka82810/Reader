import { afterEach, expect, it, vi } from 'vitest'
import { identifyWithCover } from './coverIdentify'
import { bySize } from './ocr'

const read = vi.fn()
vi.mock('./ocr', async (orig) => ({ ...(await orig<typeof import('./ocr')>()), ocrLines: (...a: unknown[]) => read(...a) }))

afterEach(() => {
  read.mockReset()
  localStorage.clear()
})

const line = (text: string, height: number) => ({ text, confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: height } })

it('puts the largest letters of a cover first, and keeps the order of lines of one size', () => {
  expect(bySize([line('הוצאת כנרת', 10), line('ריק ריירדן', 30), line('גנב הברק', 80), line('ספר ראשון', 31)])).toEqual(['גנב הברק', 'ריק ריירדן', 'ספר ראשון', 'הוצאת כנרת'])
  expect(bySize([line('x', 50), { text: 'מילים', confidence: 20 }])).toEqual([])
})

const book = { id: 'b1', title: '1~2402 1', author: 'ריק ריירדן', fileName: 'x.pdf', cover: new Blob(['img']) }

it('reads the cover of a book whose name says nothing as a title page, once, and offers what it names without being sure', async () => {
  // the largest line first, then the lines in reading order
  read.mockResolvedValue([['גנב הברק', 'ריק ריירדן', "פרסי ג'קסון", 'ספר ראשון', 'גנב הברק']])
  const r = await identifyWithCover(book, false, undefined, [], undefined)
  expect(r).toMatchObject({ series: "פרסי ג'קסון", number: '1', title: 'גנב הברק', fromText: true })
  expect(r.sure).toBeUndefined()
  expect(r.evidence).toContain('cover')
  await identifyWithCover(book, false, undefined, [], undefined)
  expect(read).toHaveBeenCalledTimes(1)
})

it('takes the line in the largest letters as the title when the cover is no title page, but not the author', async () => {
  read.mockResolvedValue([['האגף הרביעי', 'רבקה יארוס', 'האגף הרביעי', 'רבי המכר של הניו יורק טיימס']])
  expect(await identifyWithCover({ ...book, author: 'רבקה יארוס' }, false, undefined, [], undefined)).toMatchObject({ title: 'האגף הרביעי', fromText: true })
  localStorage.clear()
  // the author's name in the largest letters: the cover alone does not say which line is which, but the book's author
  // does, so the other line is the title
  read.mockResolvedValue([['רבקה יארוס', 'רבקה יארוס', 'האגף הרביעי']])
  expect(await identifyWithCover({ ...book, id: 'b2', author: 'רבקה יארוס' }, false, undefined, [], undefined)).toMatchObject({
    title: 'האגף הרביעי',
    author: 'רבקה יארוס',
    fromText: true,
  })
})

it('tells the title from the author on a cover by checking its lines against the title page', async () => {
  // the largest line is the author's name, and nothing on the cover says so; the title page does ("מאת")
  read.mockResolvedValue([['מירה אלון', 'מירה אלון', 'שביל הצפצפות']])
  const r = await identifyWithCover({ ...book, id: 'x1', author: '' }, false, undefined, ['שביל הצפצפות', 'מאת מירה אלון', 'עריכה: נועה'], undefined)
  expect(r).toMatchObject({ title: 'שביל הצפצפות', author: 'מירה אלון', fromText: true })
  expect(r.sure).toBeUndefined()
  // and the other way: the title in the largest letters, the author below it
  localStorage.clear()
  read.mockResolvedValue([['שביל הצפצפות', 'שביל הצפצפות', 'מירה אלון']])
  expect(await identifyWithCover({ ...book, id: 'x2', author: '' }, false, undefined, ['שביל הצפצפות', 'מאת מירה אלון'], undefined)).toMatchObject({
    title: 'שביל הצפצפות',
    author: 'מירה אלון',
  })
})

it('reads the cover of a book with a name too, as one more source, and keeps the name; reads nothing with no cover', async () => {
  read.mockResolvedValue([['גנב הברק', 'ריק ריירדן']])
  const r = await identifyWithCover({ ...book, id: 'named', title: 'גנב הברק', author: 'ריק ריירדן' }, false, undefined, [], undefined)
  expect(read).toHaveBeenCalled()
  expect(r).toMatchObject({ title: 'גנב הברק' })
  expect(r.evidence).toContain('cover')
  read.mockClear()
  await identifyWithCover({ ...book, id: 'bare', cover: undefined }, false, undefined, [], undefined)
  expect(read).not.toHaveBeenCalled()
})

it('names the volume a cover or a glued file name says, so two volumes of one title do not get the same name', async () => {
  const glued = { id: 'v1', title: 'שרוןחיוןגינתהלביאההלוחמתחלקב_240228_5201', author: 'שרון חיון גינת', fileName: 'x.pdf', cover: new Blob(['img']) }
  read.mockResolvedValue([['הלביאה הלוחמת', 'חלק ב', 'שרון חיון גינת']])
  expect(await identifyWithCover(glued, false, undefined, [], undefined)).toMatchObject({ title: "הלביאה הלוחמת, חלק ב'" })
  // the cover says no volume: the file name does
  read.mockResolvedValue([['הלביאה הלוחמת', 'שרון חיון גינת']])
  expect(await identifyWithCover({ ...glued, id: 'v2', title: 'שרוןחיוןגינתהלביאההלוחמתחלקא_240228_200' }, false, undefined, [], undefined)).toMatchObject({ title: "הלביאה הלוחמת, חלק א'" })
})

it('reads the cover of a book whose series is its title run together, and names it offline from the name alone', async () => {
  const stuck = { id: 'g1', title: 'הלביאה הלוחמת - הלביאההלוחמתחלקא', author: 'שרון חיון גינת', fileName: 'x.pdf', cover: new Blob(['img']) }
  // nothing read from the cover: the series said twice is no title, the volume is what is left
  read.mockResolvedValue([[]])
  expect(await identifyWithCover(stuck, false, undefined, [], undefined)).toMatchObject({ title: "הלביאה הלוחמת - חלק א'" })
})

it('splits a run-together name by the words of the library when the cover reads as nothing, and tries a cover that read as nothing again', async () => {
  const glued = { id: 'g1', title: 'שרוןחיוןגינתהלביאההלוחמתחלקב_240228_5201', author: 'שרון חיון גינת', fileName: 'x.pdf', cover: new Blob(['img']) }
  const library = { series: new Map(), titles: new Map([['הלביאה הלוחמת', 'הלביאה הלוחמת']]), authors: ['שרון חיון גינת'] }
  read.mockResolvedValue([[]])
  const r = await identifyWithCover(glued, false, undefined, [], undefined, library)
  expect(r.title).toBe("הלביאה הלוחמת, חלק ב'")
  // the empty reading was not kept: the next time the cover is read again
  read.mockResolvedValue([['הלביאה הלוחמת', 'חלק ב', 'שרון חיון גינת']])
  await identifyWithCover(glued, false, undefined, [], undefined)
  expect(read).toHaveBeenCalledTimes(2)
})
