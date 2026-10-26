import { describe, expect, it } from 'vitest'
import { authorDirOf, findDuplicateGroups } from './phoneDuplicates'

const f = (path: string, size = 10, modified = 1) => ({ path, name: path.split('/').pop()!, size, modified })

describe('findDuplicateGroups', () => {
  it('keeps the EPUB, files the one PDF as a version and offers the second PDF for deleting', () => {
    const epub = f('/s/Documents/גנב הברק.epub', 5)
    const pdf1 = f('/s/Download/גנב הברק.pdf', 50)
    const pdf2 = f('/s/Download/גנב הברק (1).pdf', 30)
    const [g] = findDuplicateGroups([pdf2, epub, pdf1])
    expect(g!.keep).toBe(epub)
    expect(g!.versions).toEqual([pdf1])
    expect(g!.surplus).toEqual([pdf2])
  })

  it('prefers the copy the library follows, then the one in the books folder, within a format', () => {
    const a = f('/s/Download/ספר ארוך.pdf', 90)
    const b = f('/s/Documents/קורא ספרים/מחבר/ספר ארוך.pdf', 10)
    expect(findDuplicateGroups([a, b])[0]!.keep).toBe(b)
    expect(findDuplicateGroups([a, b], new Set([a.path]))[0]!.keep).toBe(a)
  })

  it('leaves single books, short names and the versions folders alone', () => {
    expect(findDuplicateGroups([f('/s/a/ספר אחד.epub'), f('/s/a/ספר שני.pdf')])).toEqual([])
    expect(findDuplicateGroups([f('/s/a/א.epub'), f('/s/b/א.pdf')])).toEqual([])
    const kept = f('/s/Documents/קורא ספרים/מחבר/ספר ארוך.epub')
    expect(findDuplicateGroups([kept, f('/s/Documents/קורא ספרים/מחבר/גרסאות/PDF/ספר ארוך.pdf')])).toEqual([])
  })

  it('does not call two different titles one book', () => {
    expect(findDuplicateGroups([f('/s/פרסי ג\'קסון 1 - גנב הברק.epub'), f('/s/פרסי ג\'קסון 2 - ים המפלצות.pdf')])).toEqual([])
  })

  it('with no EPUB keeps the best copy of the one format there is', () => {
    const [g] = findDuplicateGroups([f('/s/a/ספר ארוך.pdf', 5), f('/s/b/ספר ארוך.pdf', 9)])
    expect(g!.keep.size).toBe(9)
    expect(g!.surplus).toHaveLength(1)
  })
})

describe('authorDirOf', () => {
  it('is the author folder inside the books folder', () => {
    expect(authorDirOf('/s/Documents/קורא ספרים/יוחאי מלכה/ספר.epub')).toBe('יוחאי מלכה')
    expect(authorDirOf('/s/Download/ספר.epub')).toBeUndefined()
    expect(authorDirOf('/s/Documents/קורא ספרים/ספר.epub')).toBeUndefined()
  })
})
