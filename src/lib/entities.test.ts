import { describe, expect, it } from 'vitest'
import { decodeEntities } from './entities'

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities, also doubly encoded ones', () => {
    expect(decodeEntities('א.ל. ג&apos;יימס')).toBe("א.ל. ג'יימס")
    expect(decodeEntities('מייגן מארק&#39;')).toBe("מייגן מארק'")
    expect(decodeEntities('Tom &amp; Jerry &#x27;s')).toBe("Tom & Jerry 's")
    expect(decodeEntities('a &amp;apos; b')).toBe("a ' b")
  })
  it('leaves text without entities and unknown entities alone', () => {
    expect(decodeEntities("ג'יימס")).toBe("ג'יימס")
    expect(decodeEntities('a &unknownthing; b')).toBe('a &unknownthing; b')
    expect(decodeEntities('R&D')).toBe('R&D')
  })
})
