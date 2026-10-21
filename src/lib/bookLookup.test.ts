import { afterEach, describe, expect, it, vi } from 'vitest'
import { identifyBook, identifyLocally, libraryNames, lookupOnline } from './bookLookup'

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
      sure: true,
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

describe('identifyBook by the ISBN and the package', () => {
  const meta = (m: Partial<import('./bookText').EpubMeta>) => ({ title: '', authors: [], series: '', number: '', identifiers: [], ...m })

  it('asks by the ISBN on the copyright page first, and takes the catalog title', async () => {
    const f = stubFetch(answer({ title: 'גנב הברק', subtitle: "פרסי ג'קסון והאולימפיים, ספר 1", authors: ['ריק ריירדן'] }))
    const r = await identifyBook({ title: 'גנב', author: '', fileName: 'x.pdf' }, true, undefined, ['כל הזכויות שמורות', 'מסת"ב 978-965-0-00000-4'])
    expect(queryOf(f, 0)).toBe('isbn:9789650000004')
    expect(r).toMatchObject({ series: "פרסי ג'קסון והאולימפיים", number: '1', title: 'גנב הברק', author: 'ריק ריירדן', online: true })
  })

  it("skips the original's ISBN in a Hebrew book and goes on by the title", async () => {
    const f = stubFetch(answer({ title: 'The Lightning Thief', authors: ['Rick Riordan'] }), answer({ title: 'גנב הברק', authors: ['ריק ריירדן'] }))
    const r = await identifyBook({ title: 'גנב הברק', author: '', fileName: 'x.epub' }, true, undefined, [], meta({ identifiers: ['9780306406157'] }))
    expect(queryOf(f, 0)).toBe('isbn:9780306406157')
    expect(queryOf(f, 1)).toBe('intitle:"גנב הברק"')
    expect(r).toMatchObject({ title: 'גנב הברק', author: 'ריק ריירדן' })
  })

  it("takes the package's series when the names hold none, without going online", async () => {
    const r = await identifyBook({ title: 'גנב הברק', author: 'ריק ריירדן', fileName: 'x.epub' }, false, undefined, [], meta({ series: "פרסי ג'קסון", number: '1' }))
    expect(r).toMatchObject({ series: "פרסי ג'קסון", number: '1', title: 'גנב הברק', fromMeta: true, online: false })
  })

  it("keeps a series the names already have over the package's", async () => {
    const r = await identifyBook({ title: 'סדרה 2 - שם', author: '', fileName: 'x.epub' }, false, undefined, [], meta({ series: 'אחרת', number: '5' }))
    expect(r).toMatchObject({ series: 'סדרה', number: '2', title: 'שם' })
    expect(r.fromMeta).toBeUndefined()
  })

  it("takes the package's title when the library's says nothing", async () => {
    const r = await identifyBook({ title: '1~2402 1', author: '', fileName: '1~2402 1.epub' }, false, undefined, [], meta({ title: 'בית האדם' }))
    expect(r).toMatchObject({ title: 'בית האדם', fromMeta: true })
  })
})

describe('identifyBook: when a name is sure', () => {
  it('is sure of a book found by its ISBN, and of one found by the same title and author', async () => {
    stubFetch(answer({ title: 'גנב הברק', authors: ['ריק ריירדן'] }))
    expect((await identifyBook({ title: 'x', author: '', fileName: 'x.pdf' }, true, undefined, ['ISBN 978-965-0-00000-4'])).sure).toBe(true)
    stubFetch(answer({ title: 'גנב הברק', subtitle: "פרסי ג'קסון 1", authors: ['ריק ריירדן'] }))
    expect((await identifyBook({ title: 'גנב הברק', author: 'ריק ריירדן', fileName: 'x.epub' }, true)).sure).toBe(true)
  })

  it('is not sure of a fuller title by a partial match, nor of a name read from the opening pages alone', async () => {
    stubFetch(answer({ title: 'הארי פוטר ואבן החכמים', authors: ['רולינג'] }))
    expect((await identifyBook({ title: 'הארי פוטר ואבן', author: '', fileName: 'x.epub' }, true)).sure).toBeUndefined()
    const opening = ['ריק ריירדן', "מגנוס צ'ייס", 'ספר שלישי', 'ספינת המתים']
    expect((await identifyBook({ title: '1~2402 3', author: 'ריק ריירדן', fileName: 'x.pdf' }, false, undefined, opening)).sure).toBeUndefined()
  })
})

describe('identifyBook: what a real library showed', () => {
  const id = (title: string, opening: string[] = [], author = '', fileName = 'x.epub') => identifyBook({ title, author, fileName }, false, undefined, opening)

  it("keeps a good title over a publisher's address, a review or a sentence on the opening pages", async () => {
    const opening = ['רבקה יארוס', 'האגף הרביעי', '"יצירת מופת אמיתית של פנטזיה רומנטית." - עכשיו!', "רח' אגוז 6, פארק תעשיות חמן, חבל מודיעין 7319900"]
    expect(await id('האגף הרביעי', opening, 'רבקה יארוס')).toMatchObject({ series: '', title: 'האגף הרביעי' })
    expect(await id('מלכת האוויר', ['ת.ד. 163, קרית גת, 82022 ישראל'])).toMatchObject({ series: '', title: 'מלכת האוויר' })
    expect(await id('הבגידה בכס', ['משק 33, מושב בן־שמן, 7311500'])).toMatchObject({ series: '', title: 'הבגידה בכס' })
    const prose = ['ג\'וליה נגעה לה ביד. "את תתגברי על זה." "בטוח כמו בבית," היא הודיעה.']
    expect(await id('שם קוד גחלילית', prose)).toMatchObject({ series: '', title: 'שם קוד גחלילית' })
  })

  it('reads "the first book in the series X" with the title before it', async () => {
    expect(await id('הסירנה', ['טיפאני רייז', 'הסירנה', 'הספר הראשון בסדרת החוטאים המקוריים'], 'טיפאני רייז')).toMatchObject({
      series: 'החוטאים המקוריים',
      number: '1',
      title: 'הסירנה',
    })
    expect(await id('קסם אמצע החיים: מהומה', ['מהומה', 'ספר 1 בסדרת "השלב הבא"'])).toMatchObject({ series: 'השלב הבא', number: '1', title: 'מהומה' })
  })

  it("reads an Anna's Archive name and a number in the middle, without the author run on at the end", async () => {
    const annas = 'רוצח מלכותי -- רובין הוב -- הרואים למרחק, 2 -- 1998 -- אסטרולוג -- eff1636bf56d9b30d5e9c7efff6781de -- Anna’s Archive'
    expect(await id(annas)).toMatchObject({ series: 'הרואים למרחק', number: '2', title: 'רוצח מלכותי' })
    expect(await id('קלע_הכשף_#5_קוטל_המלכה_סבסטיאן_דה_קסטל', [], 'סבסטיאן דה קסטל')).toMatchObject({
      series: 'קלע הכשף',
      number: '5',
      title: 'קוטל המלכה',
    })
  })

  it('takes no e-mail address for an author', async () => {
    expect(await id('לורה - קורא בטא (8)', [], 'rozushka769@gmail.com')).toMatchObject({ title: 'לורה - קורא בטא', author: '' })
  })
})

describe('identifyBook: names from download sites', () => {
  const id = (title: string, author = '', opening: string[] = [], fileName = 'x.epub') => identifyBook({ title, author, fileName }, false, undefined, opening)

  it('drops a bar after a title-page name, and an author pair joined by "&"', async () => {
    expect(await id('משחקים מעוותים', 'אנה האנג', ['אנה האנג', 'טוויסט', 'ספר שני', 'משחקים מעוותים |'])).toMatchObject({ series: 'טוויסט', number: '2', title: 'משחקים מעוותים' })
    expect(await id('מגיסטריום_#3_מפתח_הארד_הולי_בלק_&_קסנדרה_קלייר', 'הולי בלק וקסנדרה קלייר')).toMatchObject({ series: 'מגיסטריום', number: '3', title: 'מפתח הארד' })
  })

  it("drops Z-Library's marks, the author in parentheses, the date stamp, repeated copies and the extension", async () => {
    expect((await id('המלך דוד (שרון חיון גינת) (Z-Library) 1_241026_195826 (1)', 'שרון חיון גינת')).title).toBe('המלך דוד')
    expect((await id('תרועת מוות (טרי פראצט) עולם הדיסק 4 (z-library.sk, 1lib.sk, z-lib.sk)', 'טרי פראצט')).title).toBe('תרועת מוות עולם הדיסק 4')
    expect((await id('סיכוי טוב למות (As Good As Dead) (הולי גקסון) (z-library.sk, 1lib.sk, z-lib.sk) (1)')).title).toBe('סיכוי טוב למות (הולי גקסון)')
    expect((await id('עותק של עותק של הארי פוטר 1 ואבן החכמים')).title).toBe('הארי פוטר 1 ואבן החכמים')
    expect((await id('arkanos_vol5_glossary.md')).title).toBe('arkanos vol5 glossary')
  })

  it("drops an uploader's credit, and takes the author and series of an Anna's Archive name", async () => {
    expect(await id('נמסיס', 'גרג הורביץ', [], 'פרויקט איקס 2 - נמסיס - הועלה על ידי קישקע נייעס.epub')).toMatchObject({ series: 'פרויקט איקס', number: '2', title: 'נמסיס' })
    const annas = 'רוצח מלכותי -- רובין הוב -- הרואים למרחק,2 -- 1998 --אסטרולוג -- eff1636bf56d9b30d5e9c7efff6781de -- Anna’s Archive'
    expect(await id(annas)).toMatchObject({ series: 'הרואים למרחק', number: '2', title: 'רוצח מלכותי', author: 'רובין הוב' })
  })
})

describe('identifyBook: a name with its number in the middle', () => {
  const library = libraryNames([
    { title: 'שיר של אש ושל קרח 3 - סופת החרבות', author: "ג'ורג' ר ר מרטין" },
    { title: 'המועמדת 2 - העילית', author: 'קיארה קאס' },
  ])
  const id = (title: string, author = '', online = false) => identifyBook({ title, author, fileName: 'x.epub' }, online, undefined, [], undefined, library)

  it('splits it at a series the library has, and takes off an author it has; sure when the series is the same author\'s', async () => {
    const r = await id("שיר_של_אש_ושל_קרח_1_משחקי_הכס_ג'ורג'_ר_ר_מרטין")
    expect(r).toMatchObject({ series: 'שיר של אש ושל קרח', number: '1', title: 'משחקי הכס', author: "ג'ורג' ר ר מרטין", sure: true })
    expect(await id('המועמדת 1 קיארה קאס')).toMatchObject({ series: '', title: 'המועמדת 1', author: 'קיארה קאס' })
  })

  it('leaves it whole when the library knows neither the series nor the author', async () => {
    expect(await id('הארי פוטר 1 ואבן החכמים')).toMatchObject({ series: '', title: 'הארי פוטר 1 ואבן החכמים' })
  })

  it('splits it by Google Books when the catalog has the series in the title', async () => {
    const f = stubFetch(answer({ title: 'הארי פוטר ואבן החכמים', authors: ["ג'יי קיי רולינג"] }))
    expect(await id('הארי פוטר 1 ואבן החכמים', '', true)).toMatchObject({
      series: 'הארי פוטר',
      number: '1',
      title: 'הארי פוטר ואבן החכמים',
      author: "ג'יי קיי רולינג",
      online: true,
    })
    expect(queryOf(f, 0)).toBe('intitle:"הארי פוטר ואבן החכמים"')
  })

  it('does not split by an entry that names only part of it', async () => {
    stubFetch(answer({ title: 'קיארה קאס' }), answer({ title: 'קיארה קאס' }), answer())
    expect(await id('הנסיכה 1 קיארה קאס', '', true)).toMatchObject({ series: '' })
  })
})
