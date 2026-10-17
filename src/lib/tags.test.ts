import { describe, expect, it } from 'vitest'
import { hasTag, listTags, parseTags, tagKey } from './tags'

describe('tags', () => {
  it('splits typed text, trims, drops empties and duplicates', () => {
    expect(parseTags(' fantasy, #Classic ;; fantasy ,  to  read \n')).toEqual(['fantasy', 'Classic', 'to read'])
    expect(parseTags('')).toEqual([])
  })

  it('ignores case and nikud when comparing', () => {
    expect(tagKey('מֹשֶׁה')).toBe(tagKey('משה'))
    expect(hasTag({ tags: ['Fantasy'] }, tagKey('fantasy'))).toBe(true)
    expect(hasTag({}, tagKey('x'))).toBe(false)
  })

  it('counts books per tag', () => {
    const tags = listTags([{ tags: ['b', 'A'] }, { tags: ['a'] }, {}])
    expect(tags.map((x) => [x.name, x.count])).toEqual([['A', 2], ['b', 1]])
  })
})
