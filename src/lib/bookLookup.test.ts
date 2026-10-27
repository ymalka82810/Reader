import { afterEach, describe, expect, it, vi } from 'vitest'
import { asLibrarySeries, clearBooksCache, tidyName, identifyBook, identifyLocally, libraryNames, lookupOnline, openLibrarySeries, withoutSeries } from './bookLookup'
import { formatBookName, splitBookName } from './bookName'
import { setConsent } from './consent'

const translateText = vi.fn()
vi.mock('./translate', () => ({ translateText: (...a: unknown[]) => translateText(...a) }))

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
      evidence: ['catalog'],
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
  it('is sure of a book found by its ISBN', async () => {
    stubFetch(answer({ title: 'גנב הברק', authors: ['ריק ריירדן'] }))
    expect((await identifyBook({ title: 'x', author: '', fileName: 'x.pdf' }, true, undefined, ['ISBN 978-965-0-00000-4'])).sure).toBe(true)
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
    expect((await id('סיכוי טוב למות (As Good As Dead) (הולי גקסון) (z-library.sk, 1lib.sk, z-lib.sk) (1)')).title).toBe('סיכוי טוב למות')
    expect((await id('עותק של עותק של הארי פוטר 1 ואבן החכמים')).title).toBe('הארי פוטר 1 ואבן החכמים')
    expect((await id('arkanos_vol5_glossary.md')).title).toBe('arkanos vol5 glossary')
  })

  it("takes the author out of Z-Library's parentheses, in Hebrew when an English spelling follows, and leaves other parentheses alone", async () => {
    const byName = (title: string) => identifyBook({ title, author: '', fileName: 'x.epub' }, false)
    expect(await byName('תרועת מוות (טרי פראצט) עולם הדיסק 4 (z-library.sk, 1lib.sk, z-lib.sk)')).toMatchObject({ title: 'תרועת מוות עולם הדיסק 4', author: 'טרי פראצט' })
    expect(await byName('פולחני כשף עולם הדיסק 3 (Equal Rites) (טרי פראצט; Terry Pratchett) (z-library.sk, 1lib.sk, z-lib.sk)')).toMatchObject({ title: 'פולחני כשף עולם הדיסק 3', author: 'טרי פראצט' })
    expect(await byName('סיכוי טוב למות (As Good As Dead) (הולי גקסון) (z-library.sk, 1lib.sk, z-lib.sk) (1)')).toMatchObject({ title: 'סיכוי טוב למות', author: 'הולי גקסון' })
    expect((await byName('ספר (מהדורה מיוחדת)')).title).toBe('ספר (מהדורה מיוחדת)')
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
    await identifyBook({ title: 'גנב הברק', author: '', fileName: 'x.epub' }, true)
    clearBooksCache() // as after a restart: read back from the device
    expect(await identifyBook({ title: 'גנב הברק', author: '', fileName: 'x.epub' }, true)).toMatchObject({ online: true })
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

  it('finds the title of a series\' book whose title only repeats the series and its number', async () => {
    stubCatalogs([answer()], (url) =>
      url.includes('wikidata') ? wikidata('משפחת קיין והאלים המצריים', { series: 'משפחת קיין והאלים המצריים', title: 'הפירמידה האדומה', author: 'ריק ריירדן' }) : empty,
    )
    const meta = { series: 'משפחת קיין והאלים המצריים', number: '1', title: '', authors: [], identifiers: [] }
    const r = await identifyBook({ title: 'משפחת קיין 1', author: 'ריק ריירדן', fileName: 'x.epub' }, true, undefined, [], meta)
    expect(formatBookName(r)).toBe('משפחת קיין והאלים המצריים 1 - הפירמידה האדומה')
  })

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
    const r = await identifyBook({ title: 'גנב הברק', author: '', fileName: 'x.epub' }, true)
    expect(r).toMatchObject({ series: "פרסי ג'קסון והאולימפיים", number: '1', title: 'גנב הברק', online: true, sites: ['Open Library', 'Wikidata'] })
    expect(r.failed).toBeUndefined()
  })

  it('asks Open Library when Google Books refuses, and then is not "failed"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = stubCatalogs([], (url) => (url.includes('openlibrary.org/search.json') ? openLibrary({ docs: [{ title: 'The Lightning Thief', author_name: ['Rick Riordan'] }] }) : empty))
    f.mockResolvedValue({ ok: false, status: 429 } as Response)
    const r = await identifyBook({ title: 'The Lightning Thief', author: '', fileName: 'x.epub' }, true)
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
    const r = await identifyBook({ title: 'גנב הברק', author: '', fileName: 'x.epub' }, true)
    expect(r).toMatchObject({ series: "פרסי ג'קסון והאולימפיים", number: '1', sites: ['Google Books', 'Wikidata'] })
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
    await identifyBook({ title: 'ספר אחד', author: '', fileName: 'a.epub' }, true)
    await identifyBook({ title: 'ספר שני', author: '', fileName: 'b.epub' }, true)
    expect(f.all.mock.calls.filter((c) => String(c[0]).includes('openlibrary'))).toHaveLength(1)
  })

  it('sends the user\'s Google Books key, whose quota a refusal without it does not stop', async () => {
    localStorage.setItem('reader:books-blocked-until', String(Date.now() + 60_000))
    localStorage.setItem('reader:settings', JSON.stringify({ googleBooksKey: 'my-key' }))
    const f = stubFetch(answer({ title: 'גנב הברק', authors: ['ריק ריירדן'] }))
    await identifyBook({ title: 'גנב הברק', author: '', fileName: 'x.epub' }, true)
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

  const magisterium = () =>
    libraryNames([
      { title: 'מגיסטריום 1 - מבחן הברזל', author: 'הולי בלק וקסנדרה קלייר' },
      { title: 'מגיסטריום 4 - מסכת הכסף', author: 'הולי בלק וקסנדרה קלייר' },
    ])
  const goldenOpening = ['Holly Black and Cassandra Clare', 'THE GOLDEN TOWER', 'MAGISTERIUM V', 'Copyright © 2018 by Holly Black and Cassandra Clare LLC', 'כל הזכויות שמורות']
  const book = { title: '1~___#5_', author: 'הולי בלק וקסנדרה קלייר', fileName: '__5____1.pdf' }

  it('takes the title from the running head, not the series or the author printed there too', async () => {
    const meta = { running: ['הולי בלק וקסנדרה קלייר', 'מגדל הזהב'], title: '', authors: [], series: '', number: '', identifiers: [] }
    const r = await identifyBook(book, false, undefined, goldenOpening, meta, magisterium())
    expect(formatBookName(r)).toBe('מגיסטריום 5 - מגדל הזהב')
  })

  it('translates the original title when the book has no other, with the user\'s consent to translate', async () => {
    stubCatalogs([], () => empty).mockResolvedValue(answer())
    translateText.mockResolvedValue('מגדל הזהב')
    setConsent('translate', true)
    const r = await identifyBook(book, true, undefined, goldenOpening, undefined, magisterium())
    expect(formatBookName(r)).toBe('מגיסטריום 5 - מגדל הזהב')
    expect(translateText).toHaveBeenCalledWith('The Golden Tower', 'en', 'he', undefined)
    expect(r.sure).toBeUndefined()
  })

  it('does not translate without that consent', async () => {
    stubCatalogs([], () => empty).mockResolvedValue(answer())
    translateText.mockClear()
    setConsent('translate', false)
    const r = await identifyBook(book, true, undefined, goldenOpening, undefined, magisterium())
    expect(formatBookName(r)).toBe('מגיסטריום 5')
    expect(translateText).not.toHaveBeenCalled()
  })

  it('numbers a book of a series by the gaps the library leaves and the years of its books', async () => {
    const library = libraryNames([
      { title: 'מגיסטריום 1 - מבחן הברזל', author: 'הולי בלק וקסנדרה קלייר', id: 'b1', kind: 'pdf' },
      { title: 'מגיסטריום 3 - מפתח הארד', author: 'הולי בלק וקסנדרה קלייר', id: 'b3', kind: 'pdf' },
      { title: 'מגיסטריום 4 - מסכת הכסף', author: 'הולי בלק וקסנדרה קלייר', id: 'b4', kind: 'pdf' },
    ])
    localStorage.setItem('reader:book-facts', JSON.stringify({ b1: { year: 2014, names: [] }, b3: { year: 2016, names: [] }, b4: { year: 2017, names: [] } }))
    const opening = ['Holly Black and Cassandra Clare', 'THE GOLDEN TOWER', 'MAGISTERIUM', 'Copyright © 2018 by Holly Black and Cassandra Clare LLC']
    const meta = { running: ['מגדל הזהב'], title: '', authors: [], series: '', number: '', identifiers: [] }
    const r = await identifyBook(book, false, undefined, opening, meta, library)
    expect(formatBookName(r)).toBe('מגיסטריום 5 - מגדל הזהב')
    expect(r.sure).toBeUndefined()
  })

  it('puts a book in the author\'s series whose books share its names, and numbers it', async () => {
    const names = (ws: string[]): [string, number][] => ws.map((w) => [w, 10])
    const library = libraryNames([
      { title: 'מגיסטריום 1 - מבחן הברזל', author: 'הולי בלק וקסנדרה קלייר', id: 'b1', kind: 'pdf' },
      { title: 'מגיסטריום 2 - יד הנחושת', author: 'הולי בלק וקסנדרה קלייר', id: 'b2', kind: 'pdf' },
      { title: 'עולם אחר 1 - ספר', author: 'הולי בלק וקסנדרה קלייר', id: 'c1', kind: 'pdf' },
    ])
    localStorage.setItem(
      'reader:book-facts',
      JSON.stringify({
        b1: { year: 2014, names: names(['קאל', 'ארון', 'טמרה', 'רופוס', 'אלסטייר']) },
        b2: { year: 2015, names: names(['קאל', 'ארון', 'טמרה', "ג'ספר"]) },
        c1: { year: 2010, names: names(['ג\'וד', 'קרדן', 'טירין']) },
      }),
    )
    const meta = { names: names(['קאל', 'ארון', 'טמרה', "ג'ספר", 'השמידו']), title: '', authors: [], series: '', number: '', identifiers: [] }
    const r = await identifyBook({ title: 'מפתח הארד', author: 'הולי בלק וקסנדרה קלייר', fileName: 'x.pdf' }, false, undefined, ['Copyright © 2016 by Holly Black'], meta, library)
    expect(formatBookName(r)).toBe('מגיסטריום 3 - מפתח הארד')
    expect(r.sure).toBeUndefined()
  })

  it('numbers a book by a list of its series it prints, the series being another listed book\'s in the library', async () => {
    const library = libraryNames([{ title: 'מגיסטריום 1 - מבחן הברזל', author: 'הולי בלק וקסנדרה קלייר' }])
    const lists = [{ series: '', books: ['מבחן הברזל', 'יד הנחושת', 'מפתח הארד'].map((title, i) => ({ title, number: String(i + 1) })) }]
    const meta = { lists, title: '', authors: [], series: '', number: '', identifiers: [] }
    const r = await identifyBook({ title: 'יד הנחושת', author: 'הולי בלק וקסנדרה קלייר', fileName: 'x.pdf' }, false, undefined, [], meta, library)
    expect(formatBookName(r)).toBe('מגיסטריום 2 - יד הנחושת')
    expect(r.sure).toBeUndefined()
    // and the list is kept for the series' other books
    const other = await identifyBook({ title: 'מפתח הארד', author: 'הולי בלק וקסנדרה קלייר', fileName: 'y.pdf' }, false, undefined, [], undefined, library)
    expect(formatBookName(other)).toBe('מגיסטריום 3 - מפתח הארד')
  })

  it('takes the series a list names, as the library names it', async () => {
    const lists = [{ series: 'כס הזכוכית', books: [{ title: 'כס הזכוכית', number: '1' }, { title: 'כתר חצות', number: '2' }] }]
    const meta = { lists, title: '', authors: [], series: '', number: '', identifiers: [] }
    const r = await identifyBook({ title: 'כתר חצות', author: "שרה ג'יי מאס", fileName: 'x.epub' }, false, undefined, [], meta, libraryNames([]))
    expect(formatBookName(r)).toBe('כס הזכוכית 2 - כתר חצות')
  })

  describe('weighing the clues', () => {
    const lists = [{ series: 'מגיסטריום', books: ['מבחן הברזל', 'יד הנחושת', 'מפתח הארד', 'מסכת הכסף', 'מגדל הזהב'].map((title, i) => ({ title, number: String(i + 1) })) }]
    const opening = ['THE GOLDEN TOWER', 'MAGISTERIUM V', 'Copyright © 2018 by Holly Black and Cassandra Clare LLC']
    const library = () => libraryNames([{ title: 'מגיסטריום 1 - מבחן הברזל', author: 'הולי בלק וקסנדרה קלייר' }])
    const book = { title: 'מגדל הזהב', author: 'הולי בלק וקסנדרה קלייר', fileName: 'x.pdf' }

    it('is sure of a name two clues agree on and none speaks against', async () => {
      const meta = { lists, title: '', authors: [], series: '', number: '', identifiers: [] }
      const r = await identifyBook(book, false, undefined, opening, meta, library())
      expect(formatBookName(r)).toBe('מגיסטריום 5 - מגדל הזהב')
      expect(r.evidence).toEqual(expect.arrayContaining(['copyright', 'list']))
      expect(r.sure).toBe(true)
    })

    it('is not sure when a clue speaks against, and says which', async () => {
      const other = [{ series: 'מגיסטריום', books: [{ title: 'מגדל הזהב', number: '4' }, { title: 'x', number: '5' }] }]
      const meta = { lists: other, title: '', authors: [], series: '', number: '', identifiers: [] }
      const r = await identifyBook(book, false, undefined, opening, meta, library())
      expect(r.conflicts).toEqual(['list'])
      expect(r.sure).toBeUndefined()
    })

    it('speaks against a number the library already has for another book', async () => {
      const lib = libraryNames([{ title: 'מגיסטריום 5 - ספר אחר', author: 'הולי בלק וקסנדרה קלייר' }])
      const r = await identifyBook(book, false, undefined, opening, undefined, lib)
      expect(r.conflicts).toContain('order')
    })
  })

  it('makes no series of a joining word two titles end with ("לחלום על 10", "לרקוד על 9")', () => {
    const lib = libraryNames([{ title: 'לחלום על 10' }, { title: 'לרקוד על 9' }])
    expect([...lib.series.values()].map((s) => s.name)).not.toContain('על')
  })

  it('keeps a number that ends a title after a joining word, even when a name saved before made that word a series', async () => {
    // "הבחורים של טומן": "לחלום על 10", "לשחרר את 10"; and a wrong name saved before, "על 9 - לרקוד"
    const lib = libraryNames([{ title: 'על 9 - לרקוד' }, { title: 'לשמור על 13' }, { title: 'לשחרר את 10' }])
    const r = await identifyBook({ title: 'לחלום על 10', author: 'קלואי וולש', fileName: 'x.epub' }, false, undefined, [], undefined, lib)
    expect(formatBookName(r)).toBe('לחלום על 10')
  })

  it('does not speak against a number held by another copy of the same book', async () => {
    const lib = libraryNames([{ title: 'המועמדת 3 - האחת', author: 'קיארה קאס' }])
    const lists = [{ series: 'המועמדת', books: ['המועמדת', 'העילית', 'האחת'].map((title, i) => ({ title, number: String(i + 1) })) }]
    const meta = { lists, title: '', authors: [], series: '', number: '', identifiers: [] }
    const r = await identifyBook({ title: 'האחת', author: 'קיארה קאס', fileName: 'x.pdf' }, false, undefined, [], meta, lib)
    expect(formatBookName(r)).toBe('המועמדת 3 - האחת')
    expect(r.conflicts).toBeUndefined()
  })

  it('numbers a book of a series by its original title on Wikidata', async () => {
    const library = libraryNames([{ title: 'פרויקט X 1 - פרויקט X', author: 'גרג הורביץ', id: 'x1', kind: 'epub' }])
    const names = (ws: string[]): [string, number][] => ws.map((w, i) => [w, 50 - i])
    // no year for the first book, so only Wikidata can number it
    localStorage.setItem('reader:book-facts', JSON.stringify({ x1: { year: null, names: names(['אוון', 'ג\'ק', 'ג\'ואי', 'מיה']) } }))
    const meta = { names: names(['אוון', 'ג\'ק', 'ג\'ואי', 'קנדרה']), title: '', authors: [], series: '', number: '', identifiers: [] }
    stubCatalogs([], (url) =>
      url.includes('wikidata')
        ? ({
            ok: true,
            json: async () => ({
              search: [{ id: 'Q1', label: 'The Nowhere Man' }],
              results: { bindings: [{ book: { value: 'http://www.wikidata.org/entity/Q1' }, seriesLabel: { value: 'Orphan X' }, num: { value: '2' } }] },
            }),
          } as Response)
        : empty,
    ).mockResolvedValue(answer())
    const opening = ['GREGG HURWITZ', 'THE NOWHERE MAN', 'Copyright © 2017 by Gregg Hurwitz']
    const r = await identifyBook({ title: 'הבן האובד', author: 'גרג הורביץ', fileName: 'x.epub' }, true, undefined, opening, meta, library)
    expect(formatBookName(r).replace(/\u200f/g, '')).toBe('פרויקט X 2 - הבן האובד')
    expect(r.sites).toEqual(['Wikidata'])
  })

  it('mends a name an earlier version broke at a joining word, and learns no series from it', async () => {
    expect(identifyLocally({ title: 'על 10 - לחלום', author: '', fileName: 'x.epub' })).toEqual({ series: '', number: '', title: 'לחלום על 10' })
    const lib = libraryNames([{ title: 'על 9 - לרקוד', author: 'קלואי וולש' }])
    expect([...lib.series.values()].map((s) => s.name)).toEqual([])
  })

  it('leaves a series\' book no title that only repeats its place', () => {
    const n = (series: string, number: string, title: string) => tidyName({ series, number, title })
    // the series said twice: before a mark, or with its number
    expect(n('מורשת של דיו - בת פלם', '', 'מורשת של דיו - בת פלם, חלק ראשון, גרסת בטא')).toEqual({ series: 'מורשת של דיו - בת פלם', number: '', title: 'חלק ראשון, גרסת בטא' })
    expect(n('הבחורים של טומן', '4', 'הבחורים של טומן 4')).toEqual({ series: 'הבחורים של טומן', number: '4', title: '' })
    expect(n('הבחורים של טומן', '', 'הבחורים של טומן 4')).toEqual({ series: 'הבחורים של טומן', number: '4', title: '' })
    expect(n('הארי פוטר', '1', 'הארי פוטר ואבן החכמים')).toEqual({ series: 'הארי פוטר', number: '1', title: 'הארי פוטר ואבן החכמים' })
    expect(n('משפחת קיין והאלים המצריים', '1', 'משפחת קיין 1').title).toBe('')
    expect(n('גיבורי האולימפוס', '5', 'דם האולימפוס V').title).toBe('דם האולימפוס')
    expect(n('שומרת הערים האבודות', '8', '8 1~2403').title).toBe('')
    expect(n('הארי פוטר', '1', 'הארי פוטר ואבן החכמים').title).toBe('הארי פוטר ואבן החכמים')
    expect(n('הבחורים של טומן', '10', 'לחלום על 10').title).toBe('לחלום על 10')
  })
})

describe('identifyBook: the knowledge kept on the device', () => {
  const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response
  const row = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]))

  it("keeps Wikidata's whole series once it named one book, and names another book of it offline", async () => {
    stubCatalogs([answer({ title: 'גנב הברק', authors: ['ריק ריירדן'] })], (url) => {
      if (!url.includes('wikidata')) return empty
      const q = new URL(url).searchParams.get('query') ?? ''
      if (!q) return json({ search: [{ id: 'Q1', label: 'גנב הברק' }] })
      if (q.includes('wd:Q100 ;'))
        return json({
          results: {
            bindings: [
              row({ bookLabel: 'גנב הברק', num: '1' }),
              row({ bookLabel: 'ים המפלצות', num: '2' }),
              row({ bookLabel: 'קללת הטיטאן', num: '3' }),
            ],
          },
        })
      return json({
        results: {
          bindings: [
            row({ book: 'http://www.wikidata.org/entity/Q1', series: 'http://www.wikidata.org/entity/Q100', seriesLabel: "פרסי ג'קסון", num: '1', authorLabel: 'ריק ריירדן' }),
          ],
        },
      })
    })
    await identifyBook({ title: 'גנב הברק', author: 'ריק ריירדן', fileName: 'x.epub' }, true)
    vi.unstubAllGlobals()
    const r = await identifyBook({ title: 'ים המפלצות', author: 'ריק ריירדן', fileName: 'y.epub' }, false)
    expect(r).toMatchObject({ series: "פרסי ג'קסון", number: '2', title: 'ים המפלצות', online: false })
    expect(r.evidence).toContain('catalog')
  })

  it('names offline a book of a series whose other book the library saved, as a suggestion', async () => {
    const { rememberName } = await import('./bookKnowledge')
    rememberName("מגנוס צ'ייס 2 - הפטיש של תור", 'ריק ריירדן')
    const r = await identifyBook({ title: 'הפטיש של תור', author: 'ריק ריירדן', fileName: 'y.epub' }, false)
    expect(r).toMatchObject({ series: "מגנוס צ'ייס", number: '2', fromText: true })
    expect(r.sure).toBeUndefined()
  })
})

describe("identifyBook: the series' fingerprint", () => {
  it('places a book with no series and no author by the vocabulary its series shares, as a suggestion', async () => {
    const w = (...x: string[]): [string, number][] => x.map((s, i) => [s, 9 - (i % 4)])
    const style = ['אמר', 'פתאום', 'הביט']
    localStorage.setItem(
      'reader:book-facts',
      JSON.stringify({
        a1: { year: null, words: w(...style, 'מחנה', 'החצויים', 'אולימפוס', 'כירון', 'נמפה', 'קנטאור') },
        a2: { year: null, words: w(...style, 'מחנה', 'החצויים', 'אולימפוס', 'כירון', 'סאטיר', 'גרובר') },
        b1: { year: null, words: w(...style, 'אסגרד', 'ואלהאלה', 'איינהריאר', 'לוקי', 'רוני', 'תור') },
        b2: { year: null, words: w(...style, 'אסגרד', 'ואלהאלה', 'איינהריאר', 'לוקי', 'הארת', 'בליצן') },
      }),
    )
    const library = libraryNames([
      { id: 'a1', kind: 'epub', title: "פרסי ג'קסון 1 - גנב הברק", author: 'ריק ריירדן' },
      { id: 'a2', kind: 'epub', title: "פרסי ג'קסון 2 - ים המפלצות", author: 'ריק ריירדן' },
      { id: 'b1', kind: 'epub', title: "מגנוס צ'ייס 1 - חרב הקיץ", author: 'ריק ריירדן' },
      { id: 'b2', kind: 'epub', title: "מגנוס צ'ייס 2 - הפטיש של תור", author: 'ריק ריירדן' },
    ])
    const meta = { title: '', authors: [], series: '', number: '', identifiers: [], words: w(...style, 'אולימפוס', 'החצויים', 'כירון', 'מחנה', 'פוסידון', 'סאטיר') }
    const r = await identifyBook({ title: 'קללת הטיטאן', author: '', fileName: 'x.epub' }, false, undefined, [], meta, library)
    expect(r).toMatchObject({ series: "פרסי ג'קסון", title: 'קללת הטיטאן', fromText: true })
    expect(r.evidence).toContain('words')
    expect(r.sure).toBeUndefined()
    // another author's book is not placed in this author's series, however near its world; nor a name in two parts
    const other = await identifyBook({ title: 'קללת הטיטאן', author: 'מישהי אחרת', fileName: 'x.epub' }, false, undefined, [], meta, library)
    expect(other.series).toBe('')
    const parts = await identifyBook({ title: 'קללת הטיטאן - סדרה אחרת', author: '', fileName: 'x.epub' }, false, undefined, [], meta, library)
    expect(parts.series).toBe('')
  })
})

describe('identifyBook: the book before and the book after', () => {
  const meta = (m: object) => ({ title: '', authors: [], series: '', number: '', identifiers: [], ...m })
  const library = () =>
    libraryNames([
      { id: 'a1', title: "פרסי ג'קסון 1 - גנב הברק", author: 'ריק ריירדן' },
      { id: 'a3', title: "פרסי ג'קסון 3 - קללת הטיטאן", author: 'ריק ריירדן' },
    ])

  it('places a book one after the book it says it follows, and one before the book it says is next', async () => {
    const r = await identifyBook({ title: 'ים המפלצות', author: 'ריק ריירדן', fileName: 'x.epub' }, false, undefined, [], meta({ prev: ['גנב הברק'], next: ['קללת הטיטאן'] }), library())
    expect(r).toMatchObject({ series: "פרסי ג'קסון", number: '2', title: 'ים המפלצות', fromText: true })
    expect(r.evidence).toContain('sequel')
  })

  it('takes nothing when its neighbours do not agree', async () => {
    const r = await identifyBook({ title: 'ים המפלצות', author: 'ריק ריירדן', fileName: 'x.epub' }, false, undefined, [], meta({ prev: ['קללת הטיטאן'], next: ['קללת הטיטאן'] }), library())
    expect(r.series).toBe('')
  })

  it('names a book by what the book before it said of it, kept on the device', async () => {
    const { rememberSequels } = await import('./bookKnowledge')
    rememberSequels("פרסי ג'קסון 1 - גנב הברק", 'ריק ריירדן', ['ים המפלצות'])
    const r = await identifyBook({ title: 'ים המפלצות', author: 'ריק ריירדן', fileName: 'x.epub' }, false)
    expect(r).toMatchObject({ series: "פרסי ג'קסון", number: '2' })
    expect(r.evidence).toEqual(['sequel'])
  })
})

describe('identifyBook: the number the library already has', () => {
  it('does not speak against a book with its own number, under another title', async () => {
    const library = libraryNames([
      { id: 'k1', title: 'קלע הכשף 1 - קֶלַע הכֶּשֶׁף', author: 'סבסטיאן דה קסטל' },
      { id: 'k2', title: 'קלע הכשף 2 - הכישוף השני', author: 'סבסטיאן דה קסטל' },
    ])
    const meta = { title: '', authors: [], series: 'קלע הכשף', number: '1', identifiers: [] }
    const mine = await identifyBook({ id: 'k1', title: 'קלע הכשף 1 - קֶלַע הכֶּשֶׁף', author: 'סבסטיאן דה קסטל', fileName: 'x.epub' } as never, false, undefined, [], meta, library)
    expect(mine.conflicts ?? []).not.toContain('order')
    const other = await identifyBook({ id: 'k9', title: 'ספר אחר', author: 'סבסטיאן דה קסטל', fileName: 'y.epub' } as never, false, undefined, [], meta, library)
    expect(other.conflicts ?? []).toContain('order')
  })
})

describe('our own identification first', () => {
  afterEach(() => setConsent('books', false))
  it('does not ask Google Books about a book whose name gives a title and its author', async () => {
    setConsent('books', true)
    const f = stubFetch(answer({ title: 'x', authors: ['y'] }))
    const r = await identifyBook({ title: 'אליס אוזמן - עוצר נשימה 3', author: '', fileName: 'x.pdf' }, true)
    expect(f).not.toHaveBeenCalled()
    expect(r.author).toBe('אליס אוזמן')
  })
  it('asks when the name gives no author', async () => {
    setConsent('books', true)
    const f = stubFetch(answer({ title: 'עוצר נשימה', authors: ['אליס אוזמן'] }))
    await identifyBook({ title: 'עוצר נשימה', author: '', fileName: 'x.pdf' }, true)
    expect(f).toHaveBeenCalled()
  })
})
