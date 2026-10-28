import { splitGlued } from './bookName'
import { describe, expect, it } from 'vitest'
import {
  authorByDash,
  authorFromCover,
  formatBookName,
  guessBookName,
  isJunkTitle,
  nameFromOpening,
  seriesOf,
  shownName,
  splitBookName,
  tidyBookName,
  withoutAuthor,
} from './bookName'

const EXAMPLES: [string, { series: string; number: string; title: string }][] = [
  ["פרסי ג'קסון 1 - גנב הברק", { series: "פרסי ג'קסון", number: '1', title: 'גנב הברק' }],
  ['הערפילאים 2 העידן הראשון - האימפריה האחרונה', { series: 'הערפילאים', number: '2 העידן הראשון', title: 'האימפריה האחרונה' }],
  [
    'שיר של אש ושל קרח 3 - סופת החרבות, חלק ראשון - פלדה ושלג',
    { series: 'שיר של אש ושל קרח', number: '3', title: 'סופת החרבות, חלק ראשון - פלדה ושלג' },
  ],
  ['הארי פוטר 1 - אבן החכמים', { series: 'הארי פוטר', number: '1', title: 'אבן החכמים' }],
]

describe('the naming template', () => {
  it('splits a name in the template and puts it back together unchanged', () => {
    for (const [name, parts] of EXAMPLES) {
      expect(splitBookName(name)).toEqual(parts)
      expect(formatBookName(parts)).toBe(name)
    }
  })

  it('names a book outside a series by its title alone', () => {
    expect(formatBookName({ series: '', number: '', title: ' גנב  הברק ' })).toBe('גנב הברק')
    expect(splitBookName('גנב הברק - ריק ריירדן')).toEqual({ series: '', number: '', title: 'גנב הברק - ריק ריירדן' })
  })

  it('keeps a series without a number', () => {
    expect(formatBookName({ series: "פרסי ג'קסון", number: '', title: 'גנב הברק' })).toBe("פרסי ג'קסון - גנב הברק")
  })

  it('does not take a year for a series number', () => {
    expect(splitBookName('מלחמת 1948 - סיפור').series).toBe('')
    expect(guessBookName('1984 - ג׳ורג׳ אורוול').series).toBe('')
  })
})

describe('guessBookName', () => {
  it('reads the template itself', () => {
    for (const [name, parts] of EXAMPLES) expect(guessBookName(name)).toEqual(parts)
  })

  it('reads a series in brackets after the title', () => {
    expect(guessBookName("גנב הברק (פרסי ג'קסון #1)")).toEqual({ series: "פרסי ג'קסון", number: '1', title: 'גנב הברק' })
    expect(guessBookName('The Final Empire (Mistborn, Book 1)')).toEqual({ series: 'Mistborn', number: '1', title: 'The Final Empire' })
    expect(guessBookName("גנב הברק [פרסי ג'קסון, ספר ראשון]")).toEqual({ series: "פרסי ג'קסון", number: '1', title: 'גנב הברק' })
  })

  it('reads "book N" between the series and the title', () => {
    expect(guessBookName("פרסי ג'קסון ספר 1: גנב הברק")).toEqual({ series: "פרסי ג'קסון", number: '1', title: 'גנב הברק' })
    expect(guessBookName("פרסי ג'קסון - ספר שני - ים המפלצות")).toEqual({ series: "פרסי ג'קסון", number: '2', title: 'ים המפלצות' })
  })

  it('reads "#N", a colon, leading zeros and underscores', () => {
    expect(guessBookName('Mistborn #1: The Final Empire')).toEqual({ series: 'Mistborn', number: '1', title: 'The Final Empire' })
    expect(guessBookName('הארי_פוטר_01_-_אבן_החכמים')).toEqual({ series: 'הארי פוטר', number: '1', title: 'אבן החכמים' })
  })

  it('leaves a title with "חלק" or "הספר" in it alone', () => {
    expect(guessBookName('סופת החרבות, חלק ראשון - פלדה ושלג').series).toBe('')
    expect(guessBookName('הספר השני: סיפור').series).toBe('')
  })

  it('is all title when there is no series in it', () => {
    expect(guessBookName('גנב הברק')).toEqual({ series: '', number: '', title: 'גנב הברק' })
  })
})

describe('seriesOf', () => {
  it('reads the forms a catalog uses', () => {
    expect(seriesOf("פרסי ג'קסון, ספר 1")).toEqual({ series: "פרסי ג'קסון", number: '1' })
    expect(seriesOf("פרסי ג'קסון והאולימפיים #3")).toEqual({ series: "פרסי ג'קסון והאולימפיים", number: '3' })
    expect(seriesOf("ספר ראשון בסדרת פרסי ג'קסון")).toEqual({ series: "פרסי ג'קסון", number: '1' })
    expect(seriesOf('Book 2 of the Mistborn')).toEqual({ series: 'Mistborn', number: '2' })
    expect(seriesOf('The Book Thief')).toBeUndefined()
    expect(seriesOf('רומן')).toBeUndefined()
  })
})

describe('withoutAuthor', () => {
  it('drops the author from either end of a file name', () => {
    expect(withoutAuthor('גנב הברק - ריק ריירדן', 'ריק ריירדן')).toBe('גנב הברק')
    expect(withoutAuthor('ריק ריירדן - גנב הברק', 'ריק ריירדן')).toBe('גנב הברק')
    expect(withoutAuthor('גנב הברק - ריק ריירדן', '')).toBe('גנב הברק - ריק ריירדן')
    expect(withoutAuthor('פלדה - ושלג', 'ריק ריירדן')).toBe('פלדה - ושלג')
  })
})

describe('tidyBookName', () => {
  it.each([
    ['עותק של משפחה קיין 1', 'משפחה קיין 1'],
    ['Copy of גנב הברק (1)', 'גנב הברק'],
    ['הנבואה האפלה (The Dark Prophecy)', 'הנבואה האפלה'],
    ['גורלו של אפולו 1, האורקל הנסתר', 'גורלו של אפולו 1 - האורקל הנסתר'],
    ['The Trials of Apollo 4 - גורלו של אפולו 4, קברו של הרוח', 'גורלו של אפולו 4 - קברו של הרוח'],
    ['המגדל של נירון', 'המגדל של נירון'],
  ])('%s -> %s', (from, to) => {
    expect(tidyBookName(from)).toBe(to)
  })
})

describe('part and chapter words', () => {
  it('reads part and פרק as the number in a series', () => {
    expect(seriesOf('the marauders story- part 6')).toEqual({ series: 'the marauders story', number: '6' })
    expect(seriesOf('סיפור המרוטרים פרק 5')).toEqual({ series: 'סיפור המרוטרים', number: '5' })
    expect(seriesOf('הלביאה הלוחמת חלק ב')).toBeUndefined()
  })
})

describe('isJunkTitle', () => {
  it.each([
    ['1~2402 1', true],
    ['בתהמעמקיםריקריירדן', true],
    ['', true],
    ['גורלו של אפולו', false],
    ['1984', true],
    ['Dune', false],
    ['פרק', true],
    ['חלק ב', true],
    ['Part 6', true],
    ['פרק ראשון', true],
    ['פרקים של חיים', false],
  ])('%s -> %s', (title, junk) => {
    expect(isJunkTitle(title)).toBe(junk)
  })
})

describe('nameFromOpening', () => {
  const author = 'ריק ריירדן'

  it('reads the series, the number and the title from the title page', () => {
    const lines = [author, "מגנוס צ'ייס והאלים של אסגרד", 'ספר ראשון', 'להב הקיץ', 'מאנגלית: פלונית', 'הוצאת מרגנית']
    expect(nameFromOpening(lines, author).name).toEqual({ series: "מגנוס צ'ייס והאלים של אסגרד", number: '1', title: 'להב הקיץ' })
  })

  it('reads a number and a title on one line, with the article', () => {
    const lines = ["מחבר סדרת פרסי ג'קסון", 'גורלו של אפולו', 'הספר השלישי: המבוך הבוער']
    expect(nameFromOpening(lines, author).name).toEqual({ series: 'גורלו של אפולו', number: '3', title: 'המבוך הבוער' })
  })

  it('reads the English series line of a copyright page', () => {
    expect(nameFromOpening(['The Trials of Apollo, Book Three: The Burning Maze', 'Rick Riordan'], 'Rick Riordan').name).toEqual({
      series: 'The Trials of Apollo',
      number: '3',
      title: 'The Burning Maze',
    })
  })

  it('reads a title page the PDF conversion joined into one line', () => {
    const lines = ['ריק ריירדן גורלו של אפולו ספר שלישי המבוך הבוער מאנגלית: פלונית']
    expect(nameFromOpening(lines, author).name).toEqual({ series: 'גורלו של אפולו', number: '3', title: 'המבוך הבוער' })
  })

  it('offers the short lines as candidates, without the author and the credits', () => {
    const { name, candidates } = nameFromOpening([author, 'בית האדם', 'תרגום: פלוני', 'כל הזכויות שמורות'], author)
    expect(name).toBeUndefined()
    expect(candidates).toEqual(['בית האדם'])
  })
})

describe('very long input', () => {
  const slow = [
    ['tidyBookName', (x: string) => tidyBookName(x), '- '.repeat(15_000)],
    ['guessBookName', (x: string) => guessBookName(x), 'א '.repeat(15_000)],
    ['splitBookName', (x: string) => splitBookName(x), '1 '.repeat(15_000)],
    ['withoutAuthor', (x: string) => withoutAuthor(x, 'הולי בלק'), 'א '.repeat(15_000)],
  ] as const
  for (const [name, fn, input] of slow) {
    it(`${name} stays fast on a 30,000-character name`, () => {
      const t0 = performance.now()
      fn(input)
      expect(performance.now() - t0).toBeLessThan(500)
    })
  }
  it('still finds the author at the end of a long name', () => {
    expect(withoutAuthor(`${'מילה '.repeat(50)}הולי בלק`, 'הולי בלק')).toBe('מילה '.repeat(50).trim())
  })
})

describe('numbers in letters, book words and the title page author', () => {
  it('reads a number in Hebrew letters', async () => {
    const { letterNumber } = await import('./bookName')
    expect([`ג'`, 'י"א', 'כ״ב', 'ט"ו', 'ט"ז', 'א"י', 'אב'].map(letterNumber)).toEqual([3, 11, 22, 15, 16, undefined, undefined])
    expect(guessBookName("פרסי ג'קסון ג' - קללת הטיטאן")).toEqual({ series: "פרסי ג'קסון", number: '3', title: 'קללת הטיטאן' })
  })

  it('takes no "series" that is only the word for a book', () => {
    expect(guessBookName('ספר 3 - קללת הטיטאן')).toEqual({ series: '', number: '', title: 'קללת הטיטאן' })
  })

  it('takes the name by the title on the title page as the author, but not a translator, a series or initials as a sentence', async () => {
    const { authorFromOpening } = await import('./bookName')
    expect(authorFromOpening(["ג'ניפר ל. ארמנטרוט", 'ממלכה של בשר ואש', 'מאנגלית: מיכל אלפרוביץ'], 'ממלכה של בשר ואש')).toBe("ג'ניפר ל. ארמנטרוט")
    expect(authorFromOpening(['ממלכה של בשר ואש', 'תרגום: מיכל אלפרוביץ'], 'ממלכה של בשר ואש')).toBeUndefined()
    expect(authorFromOpening(['הארי פוטר', 'הארי פוטר ואבן החכמים'], 'הארי פוטר ואבן החכמים')).toBeUndefined()
  })
})

describe('a name run together by a scanner or a converter', () => {
  it('takes off a date and the number after it', () => {
    expect(tidyBookName('הלביאה_הלוחמת_240228_5201')).toBe('הלביאה הלוחמת')
    expect(tidyBookName('הלביאה_הלוחמת_240228_200')).toBe('הלביאה הלוחמת')
  })

  it('takes off an author whose name is run on to the title with no space', () => {
    expect(withoutAuthor('שרוןחיוןגינתהלביאההלוחמתחלקב', 'שרון חיון גינת')).toBe('הלביאההלוחמתחלקב')
    expect(withoutAuthor('הלביאההלוחמתשרוןחיוןגינת', 'שרון חיון גינת')).toBe('הלביאההלוחמת')
    // a short name, or a word that only starts like the author's, stays
    expect(withoutAuthor('דנהמלך', 'דנה')).toBe('דנהמלך')
    expect(withoutAuthor('גנב הברק', 'שרון חיון גינת')).toBe('גנב הברק')
  })
})

it('takes the series said a second time, run together, out of a name: what is left is the volume', () => {
  expect(tidyBookName('הלביאה הלוחמת - הלביאההלוחמתחלקא')).toBe("הלביאה הלוחמת - חלק א'")
  expect(tidyBookName('הלביאה הלוחמת - הלביאההלוחמת')).toBe('הלביאה הלוחמת')
  // a title that only starts like the series stays
  expect(tidyBookName('הלביאה הלוחמת - הלביאההלוחמתוהאגדה')).toBe('הלביאה הלוחמת - הלביאההלוחמתוהאגדה')
})

describe('splitGlued', () => {
  const vocab = new Set(['הלביאה', 'הלוחמת', 'האריה', 'האגדי'])
  it('splits words run together into the words that are known', () => {
    expect(splitGlued('הלביאההלוחמת', vocab)).toBe('הלביאה הלוחמת')
    expect(splitGlued('האריההאגדי', vocab)).toBe('האריה האגדי')
  })
  it('gives up when a part is not a known word', () => {
    expect(splitGlued('הלביאההמסתורית', vocab)).toBeUndefined()
    expect(splitGlued('הלביאה', vocab)).toBeUndefined()
  })
})

describe('authorByDash', () => {
  it('takes the side that is a person\'s name, whichever side it is on', () => {
    expect(authorByDash('אליס אוזמן - עוצר נשימה 3')).toBe('אליס אוזמן')
    expect(authorByDash('התנפצות - דנה לוי אלגרוד')).toBe('דנה לוי אלגרוד')
    expect(authorByDash('Terry Pratchett - Mort 4')).toBe('Terry Pratchett')
    expect(authorByDash("האדון - א ל ג'ייס")).toBe("א ל ג'ייס")
    expect(authorByDash('J K Rowling - Harry Potter 1')).toBe('J K Rowling')
  })
  it('prefers an author the library has', () => {
    expect(authorByDash('שרה כהן - דנה לוי', ['דנה לוי'])).toBe('דנה לוי')
  })
  it('tells nothing when both sides or neither look like a person', () => {
    expect(authorByDash('שרה כהן - דנה לוי')).toBe('')
    expect(authorByDash('גנב - הברק')).toBe('')
    expect(authorByDash('פרסי ג\'קסון 1 - גנב הברק')).toBe('')
    expect(authorByDash('a - b - c')).toBe('')
    // a series before the dash, whose title looks like a name
    expect(authorByDash("מגנס צ'ייס והאלים של אוסגרד - פטיש הרעם")).toBe('')
    expect(authorByDash("מגנס צ'ייס והאלים של אוסגרד - ספינת המתים")).toBe('')
  })
})

describe('names no one chose', () => {
  it('are junk titles', () => {
    for (const n of ['3EA41~1', 'CamScanner 06-06-2022 16.55', 'Aspose', 'Gilyon-0331147165', 'Microsoft Word - Ûè', 'IMG 2041']) expect(isJunkTitle(tidyBookName(n)), n).toBe(true)
  })
  it('leave a real title alone', () => {
    for (const n of ['גנב הברק', 'Mort 4', 'The New Page of Life', 'בין אור לחושך']) expect(isJunkTitle(tidyBookName(n)), n).toBe(false)
  })
  it('lose a date stamp in front of the title and the hyphens that stood for spaces', () => {
    expect(tidyBookName('-25-05-2022-12-06-50 בין-אור-לחושך')).toBe('בין אור לחושך')
    expect(tidyBookName('גנב הברק 25-05-2022 12-06')).toBe('גנב הברק')
  })
})

describe('authorFromCover', () => {
  it('takes the one line that is a person\'s name', () => {
    expect(authorFromCover(['עוצר נשימה', 'אליס אוזמן', 'תרגום: רחלה פנבנך'], 'עוצר נשימה')).toBe('אליס אוזמן')
    expect(authorFromCover(['מאת: דנה לוי אלגרוד', 'התנפצות'], 'התנפצות')).toBe('דנה לוי אלגרוד')
  })
  it('prefers an author the library has, and tells nothing when two lines could be the author', () => {
    expect(authorFromCover(['שרה כהן', 'דנה לוי'], 'ספר', ['דנה לוי'])).toBe('דנה לוי')
    expect(authorFromCover(['שרה כהן', 'דנה לוי'], 'ספר')).toBeUndefined()
  })
  it('does not take a part of the title or a line with a number', () => {
    expect(authorFromCover(['גנב הברק', 'ספר 1'], 'גנב הברק')).toBeUndefined()
  })
})

describe('shownName', () => {
  const S = 'שומרת הערים האבודות'
  it('shows the first book named after its series once', () => {
    expect(shownName(`${S} 1 - ${S}`)).toBe(S)
    expect(shownName(formatBookName({ series: S, number: '1', title: S }))).toBe(S)
  })
  it('shows a later book with only its series and number, and any other name as it is', () => {
    expect(shownName(`${S} 3 - ${S}`)).toBe(`${S} 3`)
    expect(shownName(`${S} 2 - גלות`)).toBe(`${S} 2 - גלות`)
    expect(shownName("פרסי ג'קסון 1 - גנב הברק")).toBe("פרסי ג'קסון 1 - גנב הברק")
    expect(shownName(S)).toBe(S)
  })
})
