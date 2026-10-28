import { describe, expect, it } from 'vitest'
import type { Line, RawItem } from './pdfLayout'
import { fixLaidLine, laidLines, logicalItems, looksLaidLtr, mergeWrappedRows } from './pdfLaid'
import { fixVisual } from './pdfText'

const rev = (s: string) => [...s].reverse().join('')
const item = (str: string, x: number, y: number, w = str.length * 5): RawItem => ({ str, x, y, w, h: 11, eol: false })
const row = (text: string, y: number, x1 = 380): Line => ({ text, y, h: 11, x0: 35, x1 })

// rows as such a PDF gives them once each Hebrew run is turned around (taken from a real book)
describe('logicalItems / laidLines', () => {
  it('turns each Hebrew run around on its own and keeps the runs in their left-to-right order', () => {
    const items = [item(rev('לכתוב'), 35, 500, 28), item('.', 63, 500, 3), item(' ', 66, 500, 4), item(rev('היא בהתה בשורה'), 69, 500)]
    expect(laidLines(items).map((l) => l.text)).toEqual(['לכתוב. היא בהתה בשורה'])
  })
  it('drops the empty spacers around vowel points, so a pointed word stays whole', () => {
    const items = [item('א', 35, 500, 7), item('ֶ', 42, 500, 0), item('ל', 41, 500, 6), item('ֵ', 47, 500, 0), item(' ', 47, 500, 0), item('י', 47, 500, 4), item(rev('ינה גילבּ'), 50, 500, 36)]
    expect(laidLines(items).map((l) => l.text)).toEqual(['אֶלֵיינה גילבּ'])
  })
  it('leaves runs without Hebrew alone', () => {
    expect(logicalItems([item('5:30', 35, 500)])[0]!.str).toBe('5:30')
  })
})

describe('fixLaidLine', () => {
  it('moves a single row’s final punctuation from its left edge to its end', () => {
    expect(fixLaidLine(['.משהו נורא עומד לקרות היום'])).toBe('משהו נורא עומד לקרות היום.')
    expect(fixLaidLine(['?בבית. אני בבית. למה זה נשמע לי כמו שקר'])).toBe('בבית. אני בבית. למה זה נשמע לי כמו שקר?')
  })
  it('puts the quotes and dashes at both edges back on their side', () => {
    expect(fixLaidLine(['".בוקר טוב לשתיכן. מצטערת, אין לי זמן לארוחת בוקר"'])).toBe('"בוקר טוב לשתיכן. מצטערת, אין לי זמן לארוחת בוקר."')
    expect(fixLaidLine(['" - אבל, אליינה, את זקוקה לחלבונים"'])).toBe('"אבל, אליינה, את זקוקה לחלבונים - "')
  })
  it('joins a wrapped line from its bottom row up', () => {
    expect(fixLaidLine(['את העט ואת היומן', '.לעבר החלון המקומר. הם נהדפו'])).toBe('את העט ואת היומן לעבר החלון המקומר. הם נהדפו.')
  })
  it('keeps the punctuation that ends the first row’s last word where it is', () => {
    expect(fixLaidLine(['מוזרה כזאת.', 'וכשפנינו לרחוב שלנו'])).toBe('מוזרה כזאת. וכשפנינו לרחוב שלנו')
    expect(fixLaidLine(['שלשום, כשדודה', 'ג\'ודית ומרגרט ואני נסענו'])).toBe("שלשום, כשדודה ג'ודית ומרגרט ואני נסענו")
  })
  it('tells an opening quote of the line from a closing one where the rows meet', () => {
    // the line opens with a quote, which was left at the right of its first row
    expect(fixLaidLine(['אקנה דונאט לפני"', ',הלימודים," אמרה אליינה בחטף'])).toBe('"אקנה דונאט לפני הלימודים," אמרה אליינה בחטף,')
    expect(fixLaidLine(['לא," אמרה אליינה"', '".לאחר היסוס, "אפילו לא נפגשתי אתו'])).toBe('"לא," אמרה אליינה לאחר היסוס, "אפילו לא נפגשתי אתו."')
    // the first row ends with a closing quote, and the line opens with another
    expect(fixLaidLine(['אנחנו בבית.""', 'ומרגרט צחקה. ואז הציפה אותי'])).toBe('"אנחנו בבית." ומרגרט צחקה. ואז הציפה אותי')
    // a quote opening the last row's first word is not the line's end
    expect(fixLaidLine(['צחקקה בשקט.', '"שקט; אני רואה…" פניה של בוני נעשו בבת'])).toBe('צחקקה בשקט. "שקט; אני רואה…" פניה של בוני נעשו בבת')
  })
  it('leaves rows without Hebrew alone', () => {
    expect(fixLaidLine(['Printed in Israel 2011.'])).toBe('Printed in Israel 2011.')
  })
})

describe('mergeWrappedRows', () => {
  it('joins rows far closer than the usual line spacing and keeps the spacing between lines', () => {
    const page = [
      row('.משהו נורא עומד לקרות היום', 553, 164),
      row('למה כתבתי את זה. פשוט טירוף', 527),
      row('אני לא יודעת', 515, 92),
      row('. .שבעולם להיות מאושרת. אבל', 489, 172),
      row('כאן, בשעה 5:30 בבוקר', 463),
      row('אבל הנה אני', 450, 90),
    ]
    const out = mergeWrappedRows([page])[0]!
    expect(out.map((l) => l.text)).toEqual([
      'משהו נורא עומד לקרות היום.',
      'אני לא יודעת למה כתבתי את זה. פשוט טירוף',
      'שבעולם להיות מאושרת. אבל. .',
      'אבל הנה אני כאן, בשעה 5:30 בבוקר',
    ])
    expect(out.map((l) => l.y)).toEqual([553, 527, 501, 475])
    // a line that fit its row is short next to the wrapped ones: the end of a paragraph
    expect(out[2]!.x1 - out[2]!.x0).toBeLessThan((out[1]!.x1 - out[1]!.x0) * 0.72)
  })
})

describe('looksLaidLtr', () => {
  const rows = Array.from({ length: 30 }, () => '?התחלת הלימודים. אז זאת הסיבה שאני מבוהלת? אני מפחדת מהן')
  it('spots the layout: turned around line by line, the punctuation clings to the next word', () => {
    const stored = rows.map((r) => fixVisual(r))
    expect(looksLaidLtr(stored, rows)).toBe(true)
  })
  it('does not flag an ordinary reversed PDF, which reads the same either way', () => {
    const line = rev('הילדים הלכו לבית הספר. הם שמחו.')
    const lines = Array.from({ length: 30 }, () => line)
    expect(looksLaidLtr(lines.map(fixVisual), lines.map(fixVisual))).toBe(false)
  })
})
