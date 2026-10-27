import { describe, expect, it } from 'vitest'
import { authorsIn } from './authorList'

describe('authorsIn', () => {
  it('splits a list of whole names', () => {
    expect(authorsIn("ניל גיימן, טרי פראצ'ט")).toEqual(['ניל גיימן', "טרי פראצ'ט"])
    expect(authorsIn('Holly Black; Cassandra Clare')).toEqual(['Holly Black', 'Cassandra Clare'])
    expect(authorsIn('A B, C D, E F')).toEqual(['A B', 'C D', 'E F'])
  })

  it('keeps one name turned around, a suffix or initials as one author', () => {
    expect(authorsIn("רולינג, ג'יי קיי")).toEqual(["רולינג, ג'יי קיי"])
    expect(authorsIn('Rowling, J. K.')).toEqual(['Rowling, J. K.'])
    expect(authorsIn('John Smith, Jr.')).toEqual(['John Smith, Jr.'])
    expect(authorsIn('ריק ריירדן')).toEqual(['ריק ריירדן'])
    expect(authorsIn('  ')).toEqual([])
  })
})
