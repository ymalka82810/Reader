import { beforeEach, describe, expect, it, vi } from 'vitest'

const books = new Map<string, { id: string; title: string; author: string; fileName: string; kind: 'epub' }>()
const updateMeta = vi.fn(async (id: string, title: string, author: string) => {
  const b = books.get(id)
  if (b) Object.assign(b, { title, author })
})
const autoSyncPhoneNames = vi.fn(async (_ids: string[]) => ({ renamed: 0, failed: 0 }))
const details = new Map<string, { opening: string[]; meta?: unknown }>()
let consent = false
let saveSure = true

vi.mock('./db', () => ({
  getBookMeta: async (id: string) => books.get(id),
  listBooks: async () => [...books.values()],
  updateMeta: (...a: [string, string, string]) => updateMeta(...a),
}))
vi.mock('./phoneFiles', () => ({ autoSyncPhoneNames: (ids: string[]) => autoSyncPhoneNames(ids) }))
vi.mock('./bookText', () => ({ bookDetails: async (b: { id: string }) => details.get(b.id) ?? { opening: [] } }))
vi.mock('./consent', () => ({ hasConsent: () => consent }))
vi.mock('./settings', () => ({ loadSettings: () => ({ autoIdentifySave: saveSure }) }))

const { identifyNew, loadPending, dropPending, backfillLeft, setBackfillLeft } = await import('./autoIdentify')

const meta = (m: object) => ({ title: '', authors: [], series: '', number: '', identifiers: [], ...m })
const add = (id: string, title: string, author = '') => books.set(id, { id, title, author, fileName: `${title}.epub`, kind: 'epub' })

beforeEach(() => {
  books.clear()
  details.clear()
  localStorage.clear()
  dropPending(loadPending().map((p) => p.id))
  updateMeta.mockClear()
  autoSyncPhoneNames.mockClear()
  consent = false
  saveSure = true
})

describe('identifyNew', () => {
  it("saves a sure name (a series from the package) and renames the phone file, offline", async () => {
    add('a', 'גנב הברק', 'ריק ריירדן')
    details.set('a', { opening: [], meta: meta({ series: "פרסי ג'קסון", number: '1' }) })
    expect(await identifyNew(['a'], new AbortController().signal)).toEqual({ saved: 1, pending: 0 })
    expect(updateMeta).toHaveBeenCalledWith('a', "פרסי ג'קסון 1 - גנב הברק", 'ריק ריירדן')
    expect(autoSyncPhoneNames).toHaveBeenCalledWith(['a'])
    expect(loadPending()).toEqual([])
  })

  it('puts a name that is not sure on the waiting list, and leaves an unchanged book alone', async () => {
    add('a', '1~2402 3', 'ריק ריירדן')
    details.set('a', { opening: ['ריק ריירדן', "מגנוס צ'ייס", 'ספר שלישי', 'ספינת המתים'] })
    add('b', 'שם רגיל')
    expect(await identifyNew(['a', 'b'], new AbortController().signal)).toEqual({ saved: 0, pending: 1 })
    expect(updateMeta).not.toHaveBeenCalled()
    expect(loadPending()).toEqual([{ id: 'a', title: "מגנוס צ'ייס 3 - ספינת המתים", author: 'ריק ריירדן', was: '1~2402 3', source: 'text' }])
  })

  it('saves by itself a name that only gains the mark keeping a Latin series before its number', async () => {
    saveSure = false
    add('a', 'פרויקט X 5 - אל תוך האש', 'גרג הורביץ')
    expect(await identifyNew(['a'], new AbortController().signal)).toEqual({ saved: 1, pending: 0 })
    expect(updateMeta).toHaveBeenCalledWith('a', 'פרויקט X\u200F 5 - אל תוך האש', 'גרג הורביץ')
  })

  it('offers no name that still says nothing', async () => {
    add('a', 'עותק של 5E70B~1')
    expect(await identifyNew(['a'], new AbortController().signal)).toEqual({ saved: 0, pending: 0 })
  })

  it('makes even a sure name wait when saving by itself is off', async () => {
    saveSure = false
    add('a', 'גנב הברק')
    details.set('a', { opening: [], meta: meta({ series: 'ס', number: '2' }) })
    expect(await identifyNew(['a'], new AbortController().signal)).toEqual({ saved: 0, pending: 1 })
    expect(loadPending()[0]).toMatchObject({ id: 'a', source: 'meta' })
  })

  it('stops when cancelled', async () => {
    add('a', 'גנב הברק')
    const ac = new AbortController()
    ac.abort()
    await expect(identifyNew(['a'], ac.signal)).rejects.toThrow()
  })
})

describe('the one-time identification of the library', () => {
  it('starts with every book, goes on with what was left, and stops once done', () => {
    expect(backfillLeft(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
    setBackfillLeft(['b', 'c', 'gone'])
    expect(backfillLeft(['a', 'b', 'c'])).toEqual(['b', 'c'])
    setBackfillLeft([])
    expect(backfillLeft(['a', 'b', 'c'])).toBeUndefined()
    setBackfillLeft(['x'])
    setBackfillLeft(undefined)
    expect(backfillLeft(['x'])).toBeUndefined()
  })

  it('counts a book whose name stays as it was, or that is gone, as done', async () => {
    add('a', 'שם רגיל')
    const left: string[][] = []
    await identifyNew(['a', 'gone'], new AbortController().signal, undefined, (l) => left.push(l))
    expect(left).toEqual([['gone'], []])
  })

  it('reports what is left after each book, and keeps a name found before it was stopped', async () => {
    add('a', '1~2402 3', 'ריק ריירדן')
    details.set('a', { opening: ['ריק ריירדן', "מגנוס צ'ייס", 'ספר שלישי', 'ספינת המתים'] })
    add('b', 'שם')
    const ac = new AbortController()
    const left: string[][] = []
    const run = identifyNew(['a', 'b'], ac.signal, undefined, (l) => {
      left.push(l)
      ac.abort()
    }, 10)
    await expect(run).rejects.toThrow()
    expect(left).toEqual([['b']])
    expect(loadPending().map((p) => p.id)).toEqual(['a'])
  })
})
