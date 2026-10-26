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
  read.mockResolvedValue([['רבקה יארוס', 'רבקה יארוס', 'האגף הרביעי']])
  expect(await identifyWithCover({ ...book, id: 'b2', author: 'רבקה יארוס' }, false, undefined, [], undefined)).toMatchObject({ title: '1~2402 1' })
})

it('leaves a book with a name alone, and one with no cover', async () => {
  expect(await identifyWithCover({ ...book, title: 'גנב הברק' }, false, undefined, [], undefined)).toMatchObject({ title: 'גנב הברק' })
  await identifyWithCover({ ...book, cover: undefined }, false, undefined, [], undefined)
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
