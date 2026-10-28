import { describe, expect, it } from 'vitest'
import { nameWithoutCredits, withoutAuthorAnywhere, withoutCredits, withoutPublisher } from './nameCredits'

const name = (series: string, number: string, title: string, author: string) => withoutCredits({ series, number, title, author }, author)

describe('withoutCredits', () => {
  it('takes the author out of the head of the series, with dots or without', () => {
    expect(name('ל א קוטון לייקשור יו', '1', 'לשבור את הקרח', 'ל. א. קוטון').series).toBe('לייקשור יו')
    expect(name('סי סי האנטר מפלי הצללים', '2', 'ערים עם שחר', 'סי.סי. האנטר').series).toBe('מפלי הצללים')
    expect(name('שרה ג׳יי מאס כס הזכוכית', '5', 'מלכת האור', "שרה ג'יי מאס").series).toBe('כס הזכוכית')
    expect(name('אלווין המילטון המורדת מהחולות', '2', 'הבוגדת בכס', 'אלווין המילטון').series).toBe('המורדת מהחולות')
  })

  it('takes out an author whose first name is cut to its first letter', () => {
    expect(name('בני הנפילים', '1', 'עיר של עצמות ק קלייר', 'קסנדרה קלייר').title).toBe('עיר של עצמות')
    expect(withoutAuthorAnywhere("ספר חדש י' מלכה", 'יוחאי מלכה')).toBe('ספר חדש')
    expect(withoutAuthorAnywhere('י מלכה - ספר חדש', 'יוחאי מלכה')).toBe('ספר חדש')
  })

  it('takes the author out of the head of the title', () => {
    expect(name('הקיץ שבו הפכתי ליפה', '1', "ג'ני האן הקיץ שבו הפכתי ליפה", "ג'ני האן").title).toBe('הקיץ שבו הפכתי ליפה')
  })

  it('takes out the publisher and its year', () => {
    const r = name('2023 הוצאת טורקיז', '9', 'רומיאו האפל שלי', "ל' ג'יי שן ופרקר ס. הנטינגטון")
    expect(r.series).toBe('')
    expect(r.number).toBe('')
    expect(r.title).toBe('רומיאו האפל שלי')
    expect(withoutPublisher('הנסיכה הוצאת כנרת זמורה 2019', false)).toBe('הנסיכה')
    expect(withoutPublisher('מלחמת 1948', false)).toBe('מלחמת 1948')
    expect(withoutPublisher('1984', false)).toBe('1984')
  })

  it('takes the series out of the head of the title', () => {
    expect(name('שומרת הערים האבודות', '', 'שומרת הערים האבודות גלות', 'שאנון מסנג׳ר').title).toBe('גלות')
  })

  it('takes the title out of the author', () => {
    expect(name('', '', 'יפהפייה פראית', 'סיאל יפהפייה פראית').author).toBe('סיאל')
  })

  it('leaves a name that carries nothing else as it is', () => {
    const r = { series: 'הייבן גרייס', number: '2', title: 'הקדושה', author: 'קלסי קלייטון' }
    expect(withoutCredits(r, r.author)).toBe(r)
    // a title that is only the author's name stays
    expect(withoutAuthorAnywhere('ריק ריירדן', 'ריק ריירדן')).toBe('ריק ריירדן')
  })

  it('cleans a name kept in the template', () => {
    expect(nameWithoutCredits('ל א קוטון לייקשור יו 1 - לשבור את הקרח', 'ל. א. קוטון').title).toBe('לייקשור יו 1 - לשבור את הקרח')
  })
})
