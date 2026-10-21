import { afterEach, describe, expect, it, vi } from 'vitest'
import { asLibrarySeries, clearBooksCache, identifyBook, identifyLocally, libraryNames, lookupOnline, openLibrarySeries, withoutSeries } from './bookLookup'
import { formatBookName, splitBookName } from './bookName'

type Info = { title?: string; subtitle?: string; authors?: string[]; seriesInfo?: { bookDisplayNumber?: string } }

const answer = (...items: Info[]) => ({ ok: true, json: async () => ({ items: items.map((volumeInfo) => ({ volumeInfo })) }) }) as Response

const empty = { ok: true, json: async () => ({}) } as Response

/** a fetch that answers each call to Google Books in turn (the mock returned), and Open Library and Wikidata with
 *  `others` (by default: nothing found) */
function stubFetch(...replies: Response[]) {
  return stubCatalogs(replies)
}

function stubCatalogs(replies: Response[], others: (url: string) => Response = () => empty) {
  const fetchMock = vi.fn()
  for (const r of replies) fetchMock.mockResolvedValueOnce(r)
  const all = vi.fn((url: string) => (String(url).includes('googleapis.com') ? fetchMock(url) : Promise.resolve(others(String(url)))))
  vi.stubGlobal('fetch', all)
  return Object.assign(fetchMock, { all })
}

const queryOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => new URL(String(fetchMock.mock.calls[call]![0])).searchParams.get('q')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  clearBooksCache()
})

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
      sites: ['Google Books'],
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
      sites: ['Google Books'],
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

describe('identifyBook: what the library knows, across spellings and endings', () => {
  const library = libraryNames([
    { title: 'פרויקט X #01 - פרויקט X', author: 'גרג הורביץ' },
    { title: 'פרויקט X #03 - קליע מהעבר', author: 'גרג הורביץ' },
    { title: 'הצבע של הקסם עולם הדיסק 1', author: 'טרי פראצט' },
    { title: 'מורט עולם הדיסק 2', author: 'טרי פראצט' },
    { title: 'סופת החרבות חלק 1' },
    { title: 'השיבה חלק 2' },
    { title: "אחת שהיא טובה (הולי ג'קסון)", author: "הולי ג'קסון" },
  ])
  const id = (title: string, author = '', fileName = 'x.epub') => identifyBook({ title, author, fileName }, false, undefined, [], undefined, library)

  it('spells a series as most of its books in the library do ("איקס" is "X"), with a mark that keeps the number after it', async () => {
    const r = await id('נמסיס', 'גרג הורביץ', 'פרויקט איקס 2 - נמסיס.epub')
    expect(r).toMatchObject({ series: 'פרויקט X', number: '2', title: 'נמסיס', sure: true })
    expect(formatBookName(r)).toBe('פרויקט X\u200F 2 - נמסיס')
    expect(splitBookName(formatBookName(r))).toEqual({ series: 'פרויקט X', number: '2', title: 'נמסיס' })
    expect(formatBookName({ series: 'הארי פוטר', number: '1', title: 'x' })).toBe('הארי פוטר 1 - x')
  })

  it("takes a series the library's books end with, and an author in Hebrew and English out of the name", async () => {
    const r = await id('פולחני כשף עולם הדיסק 3 (Equal Rites) (טרי פראצט; Terry Pratchett) (z-library.sk, 1lib.sk, z-lib.sk)')
    expect(r).toMatchObject({ series: 'עולם הדיסק', number: '3', title: 'פולחני כשף', author: 'טרי פראצט', sure: true })
    expect(await id('תרועת מוות (טרי פראצט) עולם הדיסק 4')).toMatchObject({ series: 'עולם הדיסק', number: '4', title: 'תרועת מוות' })
    expect(library.series.has('חלק')).toBe(false)
  })

  it('takes a known author out of parentheses, also without the geresh', async () => {
    expect(await id('סיכוי טוב למות (As Good As Dead) (הולי גקסון) (1)')).toMatchObject({ title: 'סיכוי טוב למות', author: "הולי ג'קסון" })
  })
})

describe('identifyBook: more of what a real library showed', () => {
  it("reads an Anna's Archive series with a dot or parentheses after the number, or long dashes between the parts", async () => {
    const parts = (series: string, sep = ' -- ') =>
      ['רוצח מלכותי', 'רובין הוב', series, '1998', 'אסטרולוג', 'eff1636bf56d9b30d5e9c7efff6781de', 'Anna’s Archive'].join(sep)
    for (const title of [parts('הרואים למרחק,2.'), parts('הרואים למרחק (2)'), parts('הרואים למרחק, 2', ' — '), parts('הרואים למרחק,2', ' – ')]) {
      const r = await identifyBook({ title, author: '', fileName: 'x.epub' }, false)
      expect(r).toMatchObject({ series: 'הרואים למרחק', number: '2', title: 'רוצח מלכותי', author: 'רובין הוב' })
    }
  })

  it('takes "the bestselling series" out of the series\' name', async () => {
    const r = await identifyBook({ title: 'היורשת', author: 'קיארה קאס', fileName: 'x.pdf' }, false, undefined, ['היורשת', 'קיארה קאס', 'ספר רביעי בסדרת רבי־המכר המועמדת'])
    expect(r).toMatchObject({ series: 'המועמדת', number: '4', title: 'היורשת' })
  })
})

describe('identifyBook: title pages joined into one line, and a busy Google Books', () => {
  it('finds a title among the words of a joined line by asking with the author, but is not sure of it', async () => {
    const f = stubFetch(answer(), answer({ title: 'להב הקיץ', subtitle: "מגנוס צ'ייס והאלים של אסגרד", authors: ['ריק ריירדן'], seriesInfo: { bookDisplayNumber: '1' } }))
    const r = await identifyBook({ title: '1~2402 1', author: 'ריק ריירדן', fileName: 'x.pdf' }, true, undefined, ['והאלים של אוסגרד להב הקיץ'])
    expect(queryOf(f, 1)).toBe('והאלים של אוסגרד להב הקיץ inauthor:"ריק ריירדן"')
    expect(r).toMatchObject({ series: "מגנוס צ'ייס והאלים של אסגרד", number: '1', title: 'להב הקיץ', online: true })
    expect(r.sure).toBeUndefined()
  })

  it('asks a book at most six times', async () => {
    const f = stubFetch(...Array.from({ length: 20 }, () => answer()))
    const opening = ['ISBN 978-965-0-00000-4', 'ISBN 978-0-306-40615-7', 'שורה ראשונה של עמוד', 'שורה שנייה של עמוד', 'שורה שלישית של עמוד']
    await identifyBook({ title: '1~2402 1', author: 'ריק ריירדן', fileName: 'x.pdf' }, true, undefined, opening)
    expect(f.mock.calls.length).toBeLessThanOrEqual(6)
  })

  it('says so when Google Books does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await identifyBook({ title: 'גנב הברק', author: '', fileName: 'x.epub' }, true)).toMatchObject({ online: false, failed: true })
  })
})

describe('identifyBook: sparing Google Books', () => {
  it('asks each question once, and keeps the answer on the device', async () => {
    const f = stubFetch(answer({ title: 'גנב הברק', authors: ['ריק ריירדן'] }))
    await identifyBook({ title: 'גנב הברק', author: 'ריק ריירדן', fileName: 'x.epub' }, true)
    clearBooksCache() // as after a restart: read back from the device
    expect(await identifyBook({ title: 'גנב הברק', author: 'ריק ריירדן', fileName: 'x.epub' }, true)).toMatchObject({ online: true })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('does not ask about a name that already has a series, a title and an author', async () => {
    const f = stubFetch()
    await identifyBook({ title: "פרסי ג'קסון 1 - גנב הברק", author: 'ריק ריירדן', fileName: 'x.epub' }, true)
    expect(f).not.toHaveBeenCalled()
  })

  it('stops asking for a while after a refusal for too many requests, and says why', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 429 })
    vi.stubGlobal('fetch', f)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await identifyBook({ title: 'גנב הברק', author: '', fileName: 'x.epub' }, true)).toMatchObject({ failed: true, why: 'quota' })
    expect(await identifyBook({ title: 'ים המפלצות', author: '', fileName: 'x.epub' }, true)).toMatchObject({ failed: true, why: 'quota' })
    // once to each catalog (Google Books, Open Library, Wikidata), and not again for the second book
    expect(f).toHaveBeenCalledTimes(3)
  })
})

describe('identifyBook: Open Library and Wikidata', () => {
  const openLibrary = (body: unknown) => ({ ok: true, json: async () => body }) as Response
  /** Wikidata answering both its search (items named `name`) and its SPARQL endpoint (`rows`) */
  const wikidata = (name: string, ...rows: { series: string; num?: string; author?: string; title?: string }[]) =>
    ({
      ok: true,
      json: async () => ({
        search: rows.map((_, i) => ({ id: `Q${i + 1}`, label: name })),
        results: {
          bindings: rows.map((r, i) => ({
            book: { value: `http://www.wikidata.org/entity/Q${i + 1}` },
            seriesLabel: { value: r.series },
            ...(r.num && { num: { value: r.num } }),
            ...(r.author && { authorLabel: { value: r.author } }),
            ...(r.title && { bookLabel: { value: r.title } }),
          })),
        },
      }),
    }) as Response

  it('reads a series and number out of Open Library\'s series field', () => {
    expect(openLibrarySeries('Percy Jackson & the Olympians ; bk. 1')).toEqual({ series: 'Percy Jackson & the Olympians', number: '1' })
    expect(openLibrarySeries('(Discworld -- 3)')).toEqual({ series: 'Discworld', number: '3' })
    expect(openLibrarySeries("פרסי ג'קסון והאולימפיים ; 2")).toEqual({ series: "פרסי ג'קסון והאולימפיים", number: '2' })
    expect(openLibrarySeries('Penguin classics')).toBeUndefined()
  })

  it('asks Open Library when Google Books finds nothing, and names it as the source', async () => {
    const f = stubCatalogs([], (url) =>
      url.includes('openlibrary.org/search.json')
        ? openLibrary({ docs: [{ title: 'גנב הברק', author_name: ['ריק ריירדן'] }] })
        : url.includes('wikidata') ? wikidata('גנב הברק', { series: "פרסי ג'קסון והאולימפיים", num: '1', author: 'ריק ריירדן' }) : empty,
    )
    f.mockResolvedValue(answer())
    const r = await identifyBook({ title: 'גנב הברק', author: 'ריק ריירדן', fileName: 'x.epub' }, true)
    expect(r).toMatchObject({ series: "פרסי ג'קסון והאולימפיים", number: '1', title: 'גנב הברק', online: true, sites: ['Open Library', 'Wikidata'], sure: true })
    expect(r.failed).toBeUndefined()
  })

  it('asks Open Library when Google Books refuses, and then is not "failed"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = stubCatalogs([], (url) => (url.includes('openlibrary.org/search.json') ? openLibrary({ docs: [{ title: 'The Lightning Thief', author_name: ['Rick Riordan'] }] }) : empty))
    f.mockResolvedValue({ ok: false, status: 429 } as Response)
    const r = await identifyBook({ title: 'The Lightning Thief', author: 'Rick Riordan', fileName: 'x.epub' }, true)
    expect(r).toMatchObject({ online: true, sites: ['Open Library'] })
    expect(r.failed).toBeUndefined()
  })

  it('takes the series from an Open Library entry found by its ISBN', async () => {
    const f = stubCatalogs([], (url) =>
      url.includes('/api/books') ? openLibrary({ 'ISBN:9780306406157': { details: { title: 'The Final Empire', series: ['Mistborn ; 1'], authors: [{ name: 'Brandon Sanderson' }] } } }) : empty,
    )
    f.mockResolvedValue(answer())
    const r = await identifyBook({ title: '1~2402 1', author: '', fileName: 'x.epub' }, true, undefined, ['ISBN 978-0-306-40615-7'])
    expect(r).toMatchObject({ series: 'Mistborn', number: '1', title: 'The Final Empire', author: 'Brandon Sanderson', sites: ['Open Library'], sure: true })
  })

  it('completes the series from Wikidata when Google Books has the book without one', async () => {
    const f = stubCatalogs([answer({ title: 'גנב הברק', authors: ['ריק ריירדן'] })], (url) =>
      url.includes('wikidata') ? wikidata('גנב הברק', { series: "פרסי ג'קסון והאולימפיים", num: '1', author: 'ריק ריירדן' }) : empty,
    )
    const r = await identifyBook({ title: 'גנב הברק', author: 'ריק ריירדן', fileName: 'x.epub' }, true)
    expect(r).toMatchObject({ series: "פרסי ג'קסון והאולימפיים", number: '1', sites: ['Google Books', 'Wikidata'], sure: true })
    const urls = f.all.mock.calls.map((c) => new URL(String(c[0]))).filter((u) => u.host.includes('wikidata'))
    expect(urls[0]!.searchParams.get('search')).toBe('גנב הברק')
    expect(urls[1]!.searchParams.get('query')).toContain('wd:Q1')
  })

  it('is not sure of a Wikidata series by another author, and takes none when two series fit', async () => {
    stubCatalogs([answer()], (url) => (url.includes('wikidata') ? wikidata('שם הספר', { series: 'סדרה', num: '2', author: 'מישהו אחר' }) : empty))
    const r = await identifyBook({ title: 'שם הספר', author: 'ריק ריירדן', fileName: 'x.epub' }, true)
    expect(r).toMatchObject({ series: 'סדרה', number: '2' })
    expect(r.sure).toBeUndefined()
    clearBooksCache()
    localStorage.clear()
    stubCatalogs([answer()], (url) => (url.includes('wikidata') ? wikidata('שם הספר', { series: 'סדרה', num: '2' }, { series: 'סדרה אחרת', num: '5' }) : empty))
    expect((await identifyBook({ title: 'שם הספר', author: '', fileName: 'x.epub' }, true)).series).toBe('')
  })

  it('takes no Wikidata series without a number, or not in Hebrew for a Hebrew book', async () => {
    stubCatalogs([answer()], (url) => (url.includes('wikidata') ? wikidata('שם הספר', { series: 'סדרה' }) : empty))
    expect((await identifyBook({ title: 'שם הספר', author: '', fileName: 'x.epub' }, true)).series).toBe('')
    clearBooksCache()
    localStorage.clear()
    stubCatalogs([answer()], (url) => (url.includes('wikidata') ? wikidata('שם הספר', { series: 'Q12345', num: '1' }) : empty))
    expect((await identifyBook({ title: 'שם הספר', author: '', fileName: 'x.epub' }, true)).series).toBe('')
  })

  it('finds the title of a name that is only a series and a number, waiting for approval', async () => {
    stubCatalogs([answer()], (url) =>
      url.includes('wikidata') ? wikidata('משפחת קיין', { series: 'משפחת קיין והאלים המצריים', title: 'הפירמידה האדומה', author: 'ריק ריירדן' }) : empty,
    )
    const r = await identifyBook({ title: 'משפחת קיין 1', author: 'ריק ריירדן', fileName: 'x.pdf' }, true)
    expect(r).toMatchObject({ series: 'משפחת קיין והאלים המצריים', number: '1', title: 'הפירמידה האדומה', sites: ['Wikidata'] })
    expect(r.sure).toBeUndefined()
  })

  it('does not take an item whose name is only like the title', async () => {
    stubCatalogs([answer()], (url) => (url.includes('wikidata') ? wikidata('שם אחר לגמרי', { series: 'סדרה', num: '2' }) : empty))
    expect((await identifyBook({ title: 'שם הספר', author: '', fileName: 'x.epub' }, true)).series).toBe('')
  })

  it('names a Wikidata series as the library does, and drops the series from the head of the title', async () => {
    const library = libraryNames([{ title: "פרסי ג'קסון 7 - זעם האלה המשולשת", author: 'ריק ריירדן' }])
    stubCatalogs([answer()], (url) =>
      url.includes('wikidata') ? wikidata("פרסי ג'קסון ותקוות האולימפוס", { series: "פרסי ג'קסון והאולימפיים", num: '5', author: 'ריק ריירדן' }) : empty,
    )
    const r = await identifyBook({ title: "פרסי ג'קסון ותקוות האולימפוס", author: 'ריק ריירדן', fileName: 'x.pdf' }, true, undefined, [], undefined, library)
    expect(r).toMatchObject({ series: "פרסי ג'קסון", number: '5', title: 'תקוות האולימפוס' })
  })
})

describe('asLibrarySeries / withoutSeries', () => {
  const library = libraryNames([
    { title: "פרסי ג'קסון 7 - זעם האלה המשולשת", author: 'ריק ריירדן' },
    { title: 'הארי 2 - משהו', author: 'מישהו' },
  ])
  it('takes the library\'s name only for the same author\'s series, of two words or more', () => {
    expect(asLibrarySeries("פרסי ג'קסון והאולימפיים", 'ריק ריירדן', library)).toBe("פרסי ג'קסון")
    expect(asLibrarySeries("פרסי ג'קסון והאולימפיים", 'סופר אחר', library)).toBe("פרסי ג'קסון והאולימפיים")
    expect(asLibrarySeries('הארי פוטר', 'מישהו', library)).toBe('הארי פוטר')
    expect(asLibrarySeries('גיבורי האולימפוס', 'ריק ריירדן', library)).toBe('גיבורי האולימפוס')
  })
  it('drops the series only when it is joined to the rest by ו or a dash', () => {
    expect(withoutSeries("פרסי ג'קסון ויום המפלצות", "פרסי ג'קסון")).toBe('יום המפלצות')
    expect(withoutSeries("פרסי ג'קסון - הקרב", "פרסי ג'קסון")).toBe('הקרב')
    expect(withoutSeries("פרסי ג'קסון חוזר", "פרסי ג'קסון")).toBe("פרסי ג'קסון חוזר")
    expect(withoutSeries('בן נפטון', 'גיבורי האולימפוס')).toBe('בן נפטון')
  })

  it('asks Open Library no more in a while once it could not be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = stubCatalogs([], (url) => {
      if (url.includes('openlibrary')) throw new TypeError('Failed to fetch')
      return empty
    })
    f.mockResolvedValue(answer())
    await identifyBook({ title: 'ספר אחד', author: 'מחבר', fileName: 'a.epub' }, true)
    await identifyBook({ title: 'ספר שני', author: 'מחבר', fileName: 'b.epub' }, true)
    expect(f.all.mock.calls.filter((c) => String(c[0]).includes('openlibrary'))).toHaveLength(1)
  })

  it('sends the user\'s Google Books key, whose quota a refusal without it does not stop', async () => {
    localStorage.setItem('reader:books-blocked-until', String(Date.now() + 60_000))
    localStorage.setItem('reader:settings', JSON.stringify({ googleBooksKey: 'my-key' }))
    const f = stubFetch(answer({ title: 'גנב הברק', authors: ['ריק ריירדן'] }))
    await identifyBook({ title: 'גנב הברק', author: 'ריק ריירדן', fileName: 'x.epub' }, true)
    expect(new URL(String(f.mock.calls[0]![0])).searchParams.get('key')).toBe('my-key')
  })

  it('infers the series and number from the original series on the copyright page, as the library names it', async () => {
    const library = libraryNames([
      { title: 'מגיסטריום 1 - מבחן הברזל', author: 'הולי בלק וקסנדרה קלייר' },
      { title: 'מגיסטריום 4 - מסכת הכסף', author: 'הולי בלק וקסנדרה קלייר' },
    ])
    const opening = ['Holly Black and Cassandra Clare', 'THE GOLDEN TOWER', 'MAGISTERIUM V', 'Copyright © 2018 by Holly Black and Cassandra Clare LLC', 'כל הזכויות שמורות']
    const r = await identifyBook({ title: '1~___#5_', author: 'הולי בלק וקסנדרה קלייר', fileName: '__5____1.pdf' }, false, undefined, opening, undefined, library)
    expect(r).toMatchObject({ series: 'מגיסטריום', number: '5', fromText: true })
    expect(r.sure).toBeUndefined()
  })
})
