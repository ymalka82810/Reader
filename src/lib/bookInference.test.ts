import { describe, expect, it } from 'vitest'
import { bookNumber, copyrightYear, inLists, namesIn, originalTitle, seriesByNames, seriesByWords, sequels, seriesLists, librarySeriesFor, numberByGaps, originalSeries, originalSeriesName, soundOf, titleCase } from './bookInference'
import { norm } from './sameBook'

describe('soundOf', () => {
  it('sounds the same in Latin and Hebrew letters', () => {
    expect(soundOf('MAGISTERIUM')).toBe(soundOf('מגיסטריום'))
    expect(soundOf('Percy Jackson')).toBe(soundOf("פרסי ג'קסון"))
    expect(soundOf('Throne of Glass')).not.toBe(soundOf('מגיסטריום'))
  })
})

describe('bookNumber', () => {
  it('reads Roman and Arabic numbers', () => {
    expect(bookNumber('V')).toBe(5)
    expect(bookNumber('IV')).toBe(4)
    expect(bookNumber('XII')).toBe(12)
    expect(bookNumber('7')).toBe(7)
    expect(bookNumber('MMXIV')).toBeUndefined()
  })
})

// the copyright page of the Hebrew "מגדל הזהב", as its PDF has it
const golden = [
  'Holly Black and Cassandra Clare',
  'THE GOLDEN TOWER',
  'MAGISTERIUM V',
  'Copyright © 2018 by Holly Black and Cassandra Clare LLC',
  'Illustrations copyright © 2018 by Scott Fischer',
  'כל הזכויות שמורות',
  'ISBN 978-965-566-939-8 מסת"ב',
]

describe('originalSeries', () => {
  it('finds the original series and number on a copyright page', () => {
    expect(originalSeries(golden)).toEqual({ series: 'MAGISTERIUM', number: '5', title: 'THE GOLDEN TOWER' })
    expect(originalSeries(['Throne of Glass, Book 4'])).toEqual({ series: 'Throne of Glass', number: '4' })
  })
  it('takes no copyright, year or Hebrew line for one', () => {
    expect(originalSeries(['Copyright © 2014 by Holly Black', 'All Rights Reserved', 'פרק 1'])).toBeUndefined()
  })
})

describe('librarySeriesFor', () => {
  const series = [
    { name: 'מגיסטריום', authors: new Set([norm('הולי בלק וקסנדרה קלייר')]) },
    { name: "פרסי ג'קסון", authors: new Set([norm('ריק ריירדן')]) },
  ]
  it('names the original series as the library does, for the same author', () => {
    expect(librarySeriesFor('MAGISTERIUM', 'הולי בלק וקסנדרה קלייר', series, norm)).toBe('מגיסטריום')
    expect(librarySeriesFor('MAGISTERIUM', 'סופר אחר', series, norm)).toBeUndefined()
    expect(librarySeriesFor('The Hunger Games', 'הולי בלק וקסנדרה קלייר', series, norm)).toBeUndefined()
  })
})

describe('titleCase', () => {
  it('turns an all-capitals title into a name', () => {
    expect(titleCase('THE GOLDEN TOWER')).toBe('The Golden Tower')
    expect(titleCase('The Iron Trial')).toBe('The Iron Trial')
  })
})

describe('copyrightYear', () => {
  it('takes the original\'s year, not the Hebrew edition\'s', () => {
    expect(copyrightYear(['Hebrew Language Copyright © 2019 Kinneret', 'Copyright © 2018 by Holly Black and Cassandra Clare LLC'])).toBe(2018)
    expect(copyrightYear(['© תשע"ה 2015 כנרת'])).toBe(2015)
    expect(copyrightYear(['פרק 1', 'שנת 2018'])).toBeUndefined()
  })
})

describe('numberByGaps', () => {
  it('guesses no number without the book\'s year', () => {
    expect(numberByGaps([{ number: 1 }, { number: 3 }])).toBeUndefined()
    expect(numberByGaps([{ number: 1 }, { number: 2 }, { number: 3 }])).toBeUndefined()
  })
  it('takes the next number only when a book before it has a year', () => {
    expect(numberByGaps([{ number: 1 }, { number: 2 }], 2020)).toBeUndefined()
    expect(numberByGaps([{ number: 1, year: 2014 }, { number: 2, year: 2015 }], 2020)).toBe(3)
  })
  it('decides between the gaps by the years', () => {
    const series = [
      { number: 1, year: 2014 },
      { number: 3, year: 2016 },
      { number: 4, year: 2017 },
    ]
    expect(numberByGaps(series, 2018)).toBe(5)
    expect(numberByGaps(series, 2015)).toBe(2)
    expect(numberByGaps(series)).toBeUndefined()
  })
})

describe('originalSeriesName', () => {
  const series = [{ name: 'מגיסטריום', authors: new Set([norm('הולי בלק וקסנדרה קלייר')]) }]
  it('finds the series named alone, in Latin or Hebrew letters', () => {
    expect(originalSeriesName(['THE GOLDEN TOWER', 'MAGISTERIUM'], 'הולי בלק וקסנדרה קלייר', series, norm)).toBe('מגיסטריום')
    expect(originalSeriesName(['מגיסטריום', 'מגדל הזהב'], 'הולי בלק וקסנדרה קלייר', series, norm)).toBe('מגיסטריום')
    expect(originalSeriesName(['מגיסטריון חדש'], 'הולי בלק וקסנדרה קלייר', series, norm)).toBeUndefined()
  })
})

describe('namesIn', () => {
  it('counts the names a story repeats, with their prefixed forms, and leaves common words and the credits out', () => {
    const lines = [
      'קאל הלך עם ארון אל המגיסטריום והוא אמר שזה בסדר',
      'וקאל חשב על טמרה ועל ארון כל הדרך אל החדר שלו',
      'לקאל לא היה מה לומר לטמרה והוא שתק עוד רגע ארוך',
      '© כל הזכויות שמורות לכנרת זמורה דביר מוציאים לאור בעמ',
    ]
    const names = Object.fromEntries(namesIn(lines))
    expect(names).toMatchObject({ קאל: 3, ארון: 2, טמרה: 2 })
    expect(names).not.toHaveProperty('אמר')
    expect(names).not.toHaveProperty('כנרת')
  })
})

describe('seriesByNames', () => {
  const book: [string, number][] = ['קאל', 'ארון', 'טמרה', "ג'ספר", 'רופוס', 'קוסם'].map((w) => [w, 10])
  it('takes the series that shares four names or more, clearly more than another', () => {
    const magisterium = { name: 'מגיסטריום', books: [['קאל', 'ארון', 'טמרה', "ג'ספר", 'מאסטר'].map((w): [string, number] => [w, 5])] }
    const other = { name: 'סדרה אחרת', books: [['קוסם', 'דרקון', 'מלך'].map((w): [string, number] => [w, 5])] }
    expect(seriesByNames(book, [magisterium, other])).toBe('מגיסטריום')
    expect(seriesByNames(book, [other])).toBeUndefined()
  })
  it('takes none when two series share about as many (one world, two series)', () => {
    const a = { name: 'א', books: [['קאל', 'ארון', 'טמרה', "ג'ספר"].map((w): [string, number] => [w, 5])] }
    const b = { name: 'ב', books: [['קאל', 'ארון', 'טמרה', 'רופוס'].map((w): [string, number] => [w, 5])] }
    expect(seriesByNames(book, [a, b])).toBeUndefined()
  })
})

describe('seriesLists', () => {
  it('reads a list of the series\' books, numbered by place or as it says', () => {
    expect(seriesLists(['ספרים נוספים בסדרה:', 'מבחן הברזל', 'יד הנחושת', 'מפתח הארד', 'מסכת הכסף', 'כל הזכויות שמורות'])).toEqual([
      { series: '', books: [
        { title: 'מבחן הברזל', number: '1' }, { title: 'יד הנחושת', number: '2' },
        { title: 'מפתח הארד', number: '3' }, { title: 'מסכת הכסף', number: '4' },
      ] },
    ])
    expect(seriesLists(['סדרת כס הזכוכית:', '1. כס הזכוכית', '2. כתר חצות', '4. מלכת האור (בקרוב)'])[0]).toEqual({
      series: 'כס הזכוכית',
      books: [{ title: 'כס הזכוכית', number: '1' }, { title: 'כתר חצות', number: '2' }, { title: 'מלכת האור', number: '4' }],
    })
    expect(seriesLists(['בסדרה:', 'ספר ראשון: הפירמידה האדומה', 'ספר שני: כס האש'])[0]!.books[1]).toEqual({ title: 'כס האש', number: '2' })
  })
  it('takes no half-title for a list', () => {
    expect(seriesLists(['סדרת מגיסטריום', 'ספר חמישי', 'מגדל הזהב', 'הולי בלק וקסנדרה קלייר'])).toEqual([])
  })
})

describe('inLists', () => {
  const lists = [
    { series: '', books: [{ title: 'מבחן הברזל', number: '1' }, { title: 'יד הנחושת', number: '2' }, { title: 'מפתח הארד', number: '3' }] },
    { series: 'מגיסטריום', books: [{ title: 'יד הנחושת', number: '2' }, { title: 'מגדל הזהב', number: '5' }] },
  ]
  it('finds the title\'s number, and the series when a list names it', () => {
    expect(inLists('יד הנחושת', lists, norm)).toMatchObject({ series: 'מגיסטריום', number: '2' })
    expect(inLists('מפתח הארד', lists, norm)).toMatchObject({ series: '', number: '3', others: ['מבחן הברזל', 'יד הנחושת'] })
    expect(inLists('ספר אחר', lists, norm)).toBeUndefined()
  })
  it('takes none when lists disagree on the number', () => {
    expect(inLists('יד הנחושת', [...lists, { series: '', books: [{ title: 'יד הנחושת', number: '4' }, { title: 'x', number: '5' }] }], norm)).toBeUndefined()
  })
})

describe('tuning from a real library', () => {
  it('takes no series for an author\'s book that shares her style but not the series\' heroes', () => {
    const style = ['מותק', 'בחורה', 'נשיקה', 'מכונית', 'מסיבה', 'טלפון']
    // a story says its heroes' names far more than any word of style
    const book: [string, number][] = [...['ליאם', 'אווה', "ג'ייק"].map((w): [string, number] => [w, 80]), ...style.map((w): [string, number] => [w, 12])]
    const series = { name: 'הפרי האסור', books: [[...['קאלי', 'נוח', 'מייסון'].map((w): [string, number] => [w, 80]), ...style.map((w): [string, number] => [w, 12])]] }
    expect(seriesByNames(book, [series])).toBeUndefined()
  })
  it('cuts what a list heading adds after a dash off the series\' name', () => {
    expect(seriesLists(['סדרת התנגשות — מארז פשע חושני:', '1. התמכרות', '2. התלקחות'])[0]!.series).toBe('התנגשות')
  })
})

describe('a series\' characters', () => {
  const n = (ws: string[]): [string, number][] => ws.map((w, i) => [w, 100 - i])
  const percy = { name: "פרסי ג'קסון", books: [n(['פרסי', "אנבת'", 'גרובר', 'לוק', 'חירון']), n(['פרסי', "אנבת'", 'טייסון', 'גרובר', 'לוק'])] }
  const apollo = { name: 'גורלו של אפולו', books: [n(['לסטר', 'מג', 'אפולו', 'פרסי', 'ליאו']), n(['לסטר', 'מג', 'אפולו', 'ליאו', 'קליפסו'])] }
  it('places a book whose guest is another series\' hero in its own series', () => {
    // Apollo's book with Percy as a guest: Percy is in Percy's cast, Lester and Meg only in Apollo's
    expect(seriesByNames(n(['לסטר', 'פרסי', 'מג', 'אפולו', "אנבת'"]), [percy, apollo])).toBe('גורלו של אפולו')
  })
  it('takes a series\' cast, not one book\'s hero', () => {
    // a hero of one Percy book only ("טייסון") is not Percy's cast
    expect(seriesByNames(n(['טייסון', 'זאוס', 'הרה', 'דיוניסוס']), [percy, apollo])).toBeUndefined()
  })
})

describe('originalTitle', () => {
  it('reads the original title over the copyright notice', () => {
    expect(originalTitle(['Holly Black and Cassandra Clare', 'THE GOLDEN TOWER', 'MAGISTERIUM V', 'Copyright © 2018 by Holly Black'])).toBe('THE GOLDEN TOWER')
    expect(originalTitle(['GREGG HURWITZ', 'THE NOWHERE MAN', 'Copyright © 2017 by Gregg Hurwitz'])).toBe('THE NOWHERE MAN')
    expect(originalTitle(['כל הזכויות שמורות', '© 2015 כנרת'])).toBeUndefined()
  })
})

describe('numberByGaps with no numbers yet', () => {
  it('orders a series\' unnumbered books by their years', () => {
    const books = [{ number: 0, year: 2016 }, { number: 0, year: 2018 }, { number: 0, year: 2019 }]
    expect(numberByGaps(books, 2017)).toBe(2)
    expect(numberByGaps(books, 2015)).toBe(1)
    expect(numberByGaps([...books, { number: 0 }], 2017)).toBeUndefined() // one with no year
    expect(numberByGaps(books, 2018)).toBeUndefined() // a year two books share
  })
})

describe('numberByGaps by the places of all the series\' books', () => {
  it('counts the unnumbered books with years among those before', () => {
    // Off-Campus: 1 numbered (2015), the others unnumbered (2015, 2016, 2016); "The Legacy" (2019) is 5, not 2
    const books = [{ number: 1, year: 2014 }, { number: 0, year: 2015 }, { number: 0, year: 2016 }, { number: 0, year: 2017 }]
    expect(numberByGaps(books, 2019)).toBe(5)
  })
  it('takes no place when a numbered book is not at its own (a book of the series missing before it)', () => {
    expect(numberByGaps([{ number: 1, year: 2014 }, { number: 3, year: 2016 }, { number: 0, year: 2015 }], 2018)).toBe(4)
    expect(numberByGaps([{ number: 1, year: 2014 }, { number: 3, year: 2016 }, { number: 0 }], 2018)).toBeUndefined()
  })
})

describe('seriesByWords', () => {
  const doc = (...w: string[]): [string, number][] => w.map((x, i) => [x, 10 - (i % 5)])
  // words every book says (the author's style) weigh nothing; the words of one series' world decide
  const style = ['אמר', 'פתאום', 'הביט']
  const a1 = doc(...style, 'מחנה', 'החצויים', 'אולימפוס', 'קנטאור', 'כירון', 'נמפה')
  const a2 = doc(...style, 'מחנה', 'החצויים', 'אולימפוס', 'כירון', 'סאטיר', 'גרובר')
  const b1 = doc(...style, 'אסגרד', 'ואלהאלה', 'איינהריאר', 'תור', 'לוקי', 'רוני')
  const b2 = doc(...style, 'אסגרד', 'ואלהאלה', 'לוקי', 'איינהריאר', 'בליצן', 'הארת')
  const series = [
    { name: 'א', books: [a1, a2] },
    { name: 'ב', books: [b1, b2] },
  ]
  const library = [a1, a2, b1, b2, doc('מילה', 'אחרת', 'לגמרי')]

  it('finds the series whose world the book speaks of', () => {
    expect(seriesByWords(doc(...style, 'אולימפוס', 'החצויים', 'כירון', 'מחנה', 'סאטיר', 'פוסידון'), series, library)).toBe('א')
    expect(seriesByWords(doc(...style, 'לוקי', 'אסגרד', 'ואלהאלה', 'איינהריאר', 'הארת', 'סמירף'), series, library)).toBe('ב')
  })

  it('finds none for a book that shares only the style, or with too few books to tell', () => {
    expect(seriesByWords(doc(...style, 'ים', 'ספינה', 'מפרש', 'גל', 'רב-חובל'), series, library)).toBeUndefined()
    expect(seriesByWords(a1, series, [a1, b1])).toBeUndefined()
  })
})

describe('sequels', () => {
  it('reads the next book a book ends with, and the one its opening says it follows', () => {
    const end = ['והוא חייך.', 'סוף', 'הספר הבא בסדרה: ים המפלצות', 'פרק ראשון מתוך ״קללת הטיטאן״', 'המשך יבוא ב״הקרב על המבוך״']
    const opening = ['ריק ריירדן', 'ים המפלצות', 'ההמשך ל״גנב הברק״', 'The sequel to The Lightning Thief']
    expect(sequels(opening, end)).toEqual({
      next: ['ים המפלצות', 'קללת הטיטאן', 'הקרב על המבוך'],
      prev: ['גנב הברק', 'The Lightning Thief'],
    })
  })

  it('finds a title quoted in a sentence, and takes nothing from the story itself', () => {
    expect(sequels(['בספר הקודם, ״גנב הברק״, פרסי גילה מי אביו.'], ['ובספר הבא, ״ים המפלצות״, הוא יפליג.']).next).toEqual(['ים המפלצות'])
    expect(sequels(['ההמשך היה ארוך ומייגע, והוא הלך הביתה לאט לאט בלי לומר מילה לאיש.'], ['הוא הביט בספר הבא שעל המדף והניח אותו בצד.'])).toEqual({ next: [], prev: [] })
  })
})
