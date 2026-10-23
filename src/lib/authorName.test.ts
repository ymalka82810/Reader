import { describe, expect, it } from 'vitest'
import { authorKey, authorOrder, libraryAuthor, sameAuthor, tidyAuthor } from './authorName'

describe('authorName', () => {
  it('turns "last, first" around, but not a suffix or a list', () => {
    expect(authorOrder("רולינג, ג'יי קיי")).toBe("ג'יי קיי רולינג")
    expect(authorOrder('Smith, Jr.')).toBe('Smith, Jr.')
    expect(authorOrder('Black, Clare, Cass')).toBe('Black, Clare, Cass')
  })

  it('takes the introducing word and the role off an author, and lists two authors', () => {
    expect(tidyAuthor('מאת: ריק ריירדן')).toBe('ריק ריירדן')
    expect(tidyAuthor('by Rick Riordan')).toBe('Rick Riordan')
    expect(tidyAuthor('ריק ריירדן (מחבר)')).toBe('ריק ריירדן')
    expect(tidyAuthor("ניל גיימן ו-טרי פראצ'ט")).toBe("ניל גיימן, טרי פראצ'ט")
    expect(tidyAuthor('Holly Black & Cassandra Clare')).toBe('Holly Black, Cassandra Clare')
    expect(tidyAuthor('טרי פראצט (Terry Pratchett)')).toBe('טרי פראצט (Terry Pratchett)')
    expect(tidyAuthor('מאתי כהן')).toBe('מאתי כהן')
    expect(tidyAuthor('אורי ורדי')).toBe('אורי ורדי')
  })

  it('hears one author across spellings and scripts', () => {
    for (const a of ['J.K. Rowling', "ג'. ק. רולינג", "רולינג, ג'יי קיי"]) expect(sameAuthor(a, "ג'יי קיי רולינג")).toBe(true)
    expect(sameAuthor('Terry Pratchett', 'טרי פראצט')).toBe(true)
    expect(sameAuthor('Holly Black & Cassandra Clare', 'הולי בלק וקסנדרה קלייר')).toBe(true)
    expect(sameAuthor('ריק ריירדן', "רוברט ג'ורדן")).toBe(false)
    expect(authorKey('אב')).toBe('')
  })

  it("gives the library's spelling, the one author with that last name, and nothing when unsure", () => {
    const lib = ["ג'יי קיי רולינג", 'ריק ריירדן', 'טרי פראצט']
    expect(libraryAuthor('J.K. Rowling', lib)).toBe("ג'יי קיי רולינג")
    expect(libraryAuthor('Rowling', lib)).toBe("ג'יי קיי רולינג")
    expect(libraryAuthor('ריק ריירדן', lib)).toBeUndefined()
    expect(libraryAuthor('Brandon Sanderson', lib)).toBeUndefined()
    expect(libraryAuthor('Clare', ['קסנדרה קלייר', 'סוזנה קלייר'])).toBeUndefined()
  })
})
