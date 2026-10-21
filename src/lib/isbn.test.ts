import { describe, expect, it } from 'vitest'
import { bookIsbns, isbnsIn } from './isbn'

describe('isbnsIn', () => {
  it('reads an ISBN-13 with dashes or spaces, and checks its digit', () => {
    expect(isbnsIn('מסת״ב 978-965-07-1234-0')).toEqual([])
    expect(isbnsIn('ISBN 978-0-306-40615-7')).toEqual(['9780306406157'])
    expect(isbnsIn('ISBN 978 0 306 40615 7, printed in Israel')).toEqual(['9780306406157'])
  })

  it('reads an ISBN-10 only on a line that says ISBN, as ISBN-13', () => {
    expect(isbnsIn('ISBN 0-306-40615-2')).toEqual(['9780306406157'])
    expect(isbnsIn('טל׳ 0306406152')).toEqual([])
  })

  it('does not take a longer run of digits', () => {
    expect(isbnsIn('97803064061571')).toEqual([])
  })
})

describe('bookIsbns', () => {
  it('puts the Israeli ISBN first in a Hebrew book, without repeats', () => {
    const lines = ['Original ISBN 978-0-306-40615-7', 'מסת"ב 978-965-0-00000-4', 'ISBN 0-306-40615-2']
    expect(bookIsbns(lines, true)).toEqual(['9789650000004', '9780306406157'])
    expect(bookIsbns(lines, false)).toEqual(['9780306406157', '9789650000004'])
  })
})
