import { describe, expect, it } from 'vitest'
import { authorKey, authorOrder, libraryAuthor, sameAuthor } from './authorName'

describe('authorName', () => {
  it('turns "last, first" around, but not a suffix or a list', () => {
    expect(authorOrder("רולינג, ג'יי קיי")).toBe("ג'יי קיי רולינג")
    expect(authorOrder('Smith, Jr.')).toBe('Smith, Jr.')
    expect(authorOrder('Black, Clare, Cass')).toBe('Black, Clare, Cass')
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
