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

  it('keeps the books Google Books did not answer about for the next start, and asks it no more this run', async () => {
    consent = true
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    add('a', 'גנב הברק')
    add('b', 'ים המפלצות')
    setBackfillLeft([])
    const offline = vi.fn()
    expect(await identifyNew(['a', 'b'], new AbortController().signal, undefined, undefined, 0, offline)).toMatchObject({ later: 2, why: 'quota' })
    expect(offline).toHaveBeenCalledWith('quota')
    // once to each catalog (Google Books, Open Library, Wikidata), each then left alone for a while
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // a quota comes back after some hours: not on the next start, but after that
    expect(backfillLeft(['a', 'b', 'c'])).toBeUndefined()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 7 * 60 * 60 * 1000)
    expect(backfillLeft(['a', 'b', 'c'])).toEqual(['a', 'b'])
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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

describe('identifyNew: the cascade', () => {
  const setup = () => {
    // "ב" names its series only by a number in the middle, which the library can split once it knows the series
    add('b', "פרסי ג'קסון 2 ים המפלצות", 'ריק ריירדן')
    add('a', 'גנב הברק', 'ריק ריירדן')
    details.set('a', { opening: [], meta: meta({ series: "פרסי ג'קסון", number: '1' }) })
  }

  it('identifies again the books around a saved name, with what it tells', async () => {
    setup()
    expect(await identifyNew(['b', 'a'], new AbortController().signal)).toEqual({ saved: 2, pending: 0 })
    expect(books.get('b')!.title).toBe("פרסי ג'קסון 2 - ים המפלצות")
  })

  it('does not without the cascade', async () => {
    setup()
    expect(await identifyNew(['b', 'a'], new AbortController().signal, undefined, undefined, 0, undefined, { cascade: false })).toEqual({ saved: 1, pending: 0 })
    expect(books.get('b')!.title).toBe("פרסי ג'קסון 2 ים המפלצות")
  })

  it("leaves a name the user gave alone, and does not offer again a name the user turned down", async () => {
    const { confirmName, declineName } = await import('./identifyLearning')
    add('a', 'גנב הברק', 'ריק ריירדן')
    details.set('a', { opening: [], meta: meta({ series: "פרסי ג'קסון", number: '1' }) })
    confirmName('a', 'גנב הברק')
    add('c', '1~2402 3', 'ריק ריירדן')
    details.set('c', { opening: ['ריק ריירדן', "מגנוס צ'ייס", 'ספר שלישי', 'ספינת המתים'] })
    declineName('c', "מגנוס צ'ייס 3 - ספינת המתים")
    expect(await identifyNew(['a', 'c'], new AbortController().signal)).toEqual({ saved: 0, pending: 0 })
    expect(updateMeta).not.toHaveBeenCalled()
  })
})

describe('neighbours', () => {
  it('ranks the series first, then the author’s books with no clear name, and leaves the rest', async () => {
    const { neighbours } = await import('./autoIdentify')
    const all = [
      { id: 'x', title: "פרסי ג'קסון 1 - גנב הברק", author: 'ריק ריירדן' },
      { id: 'y', title: 'ספינת המתים', author: 'ריק ריירדן' },
      { id: 'z', title: "פרסי ג'קסון 3 - קללת הטיטאן", author: 'ריק ריירדן' },
      { id: 'w', title: "מגנוס צ'ייס 1 - חרב הקיץ", author: 'ריק ריירדן' },
      { id: 'v', title: 'ספר אחר', author: 'מישהו אחר' },
    ]
    expect(neighbours([all[0]!], all)).toEqual(['z', 'y'])
  })
})
