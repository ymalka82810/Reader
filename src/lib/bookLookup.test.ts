import { afterEach, describe, expect, it, vi } from 'vitest'
import { identifyBook, identifyLocally, lookupOnline } from './bookLookup'

type Info = { title?: string; subtitle?: string; authors?: string[]; seriesInfo?: { bookDisplayNumber?: string } }

const answer = (...items: Info[]) => ({ ok: true, json: async () => ({ items: items.map((volumeInfo) => ({ volumeInfo })) }) }) as Response

/** a fetch that answers each call in turn */
function stubFetch(...replies: Response[]) {
  const fetchMock = vi.fn()
  for (const r of replies) fetchMock.mockResolvedValueOnce(r)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const queryOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => new URL(String(fetchMock.mock.calls[call]![0])).searchParams.get('q')

afterEach(() => vi.unstubAllGlobals())

describe('identifyLocally', () => {
  it('reads the series from the title', () => {
    expect(identifyLocally({ title: "גנב הברק (פרסי ג'קסון #1)", author: '', fileName: 'x.epub' })).toEqual({
      series: "פרסי ג'קסון",
      number: '1',
      title: 'גנב הברק',
    })
  })

  it('falls back to the file name, without the author it carries', () => {
    expect(identifyLocally({ title: 'גנב הברק', author: 'ריק ריירדן', fileName: "פרסי ג'קסון 1 - גנב הברק - ריק ריירדן.epub" })).toEqual({
      series: "פרסי ג'קסון",
      number: '1',
      title: 'גנב הברק',
    })
  })

  it('ignores a file name about another book', () => {
    expect(identifyLocally({ title: 'גנב הברק', author: '', fileName: 'סדרה 2 - משהו אחר.epub' }).series).toBe('')
  })
})

describe('lookupOnline', () => {
  it('asks by title and author, and takes the series from the catalog title', async () => {
    const f = stubFetch(answer({ title: 'ספר אחר', authors: ['מישהו'] }, { title: "פרסי ג'קסון 1 - גנב הברק", authors: ['ריק ריירדן'] }))
    expect(await lookupOnline({ title: 'גנב הברק', author: 'ריק ריירדן' })).toEqual({
      series: "פרסי ג'קסון",
      number: '1',
      title: 'גנב הברק',
      author: 'ריק ריירדן',
      online: true,
    })
    expect(queryOf(f, 0)).toBe('intitle:"גנב הברק" inauthor:"ריק ריירדן"')
  })

  it('reads the series from the subtitle', async () => {
    stubFetch(answer({ title: 'האימפריה האחרונה', subtitle: 'הערפילאים, ספר 1', authors: ['ברנדון סנדרסון'] }))
    expect(await lookupOnline({ title: 'האימפריה האחרונה', author: '' })).toMatchObject({ series: 'הערפילאים', number: '1' })
  })

  it('tries again without the author when nothing fits', async () => {
    const f = stubFetch(answer(), answer({ title: 'גנב הברק', authors: ['Rick Riordan'] }))
    expect(await lookupOnline({ title: 'גנב הברק', author: 'ריירדן' })).toMatchObject({ title: 'גנב הברק', author: 'Rick Riordan' })
    expect(queryOf(f, 1)).toBe('intitle:"גנב הברק"')
  })

  it('finds nothing when no title fits', async () => {
    stubFetch(answer({ title: 'משהו אחר לגמרי' }))
    expect(await lookupOnline({ title: 'גנב הברק', author: '' })).toBeUndefined()
  })
})

describe('identifyBook', () => {
  it('completes a missing series, a fuller title and a missing author', async () => {
    stubFetch(answer({ title: 'הארי פוטר ואבן החכמים', subtitle: 'הארי פוטר #1', authors: ["ג'יי קיי רולינג"] }))
    expect(await identifyBook({ title: 'הארי פוטר ואבן', author: '', fileName: 'hp.epub' }, true)).toEqual({
      series: 'הארי פוטר',
      number: '1',
      title: 'הארי פוטר ואבן החכמים',
      author: "ג'יי קיי רולינג",
      online: true,
    })
  })

  it('keeps the series and author the library already has, and a Hebrew author over the original', async () => {
    stubFetch(answer({ title: 'גנב הברק', subtitle: 'Percy Jackson #1', authors: ['Rick Riordan'] }))
    const got = await identifyBook({ title: "פרסי ג'קסון 1 - גנב הברק", author: '', fileName: 'x.epub' }, true)
    expect(got).toMatchObject({ series: "פרסי ג'קסון", number: '1', title: 'גנב הברק', author: '' })
  })

  it('does not go online without consent, and survives a failed lookup', async () => {
    const f = stubFetch()
    expect(await identifyBook({ title: 'גנב הברק', author: 'א', fileName: 'x.epub' }, false)).toMatchObject({ online: false, title: 'גנב הברק' })
    expect(f).not.toHaveBeenCalled()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await identifyBook({ title: 'גנב הברק', author: 'א', fileName: 'x.epub' }, true)).toMatchObject({ online: false })
  })
})

describe('identifyBook from the opening pages', () => {
  const opening = ['ריק ריירדן', "מגנוס צ'ייס והאלים של אסגרד", 'ספר שלישי', 'ספינת המתים', 'הוצאת מרגנית']

  it('reads the name from the book when the title says nothing', async () => {
    const r = await identifyBook({ title: 'עותק של 1~2402 3', author: 'ריק ריירדן', fileName: 'עותק של 1~2402 3.pdf' }, false, undefined, opening)
    expect(r).toMatchObject({ series: "מגנוס צ'ייס והאלים של אסגרד", number: '3', title: 'ספינת המתים', online: false, fromText: true })
  })

  it('keeps a series the title already has', async () => {
    const r = await identifyBook({ title: 'סדרה 2 - שם', author: '', fileName: 'x.epub' }, false, undefined, opening)
    expect(r).toMatchObject({ series: 'סדרה', number: '2', title: 'שם' })
    expect(r.fromText).toBeUndefined()
  })

  it('searches by the opening lines when the title says nothing', async () => {
    const fetchMock = stubFetch(answer({ title: 'בית האדם', subtitle: 'גיבורי האולימפוס 4', authors: ['ריק ריירדן'] }))
    const r = await identifyBook({ title: '1~2402 1', author: 'ריק ריירדן', fileName: 'x.pdf' }, true, undefined, ['ריק ריירדן', 'בית האדם'])
    expect(queryOf(fetchMock, 0)).toContain('בית האדם')
    expect(r).toMatchObject({ series: 'גיבורי האולימפוס', number: '4', title: 'בית האדם', author: 'ריק ריירדן', online: true })
  })
})
