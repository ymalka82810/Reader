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

describe('findDuplicateGroups by what is inside the files', () => {
  const id = (title: string, author = '') => ({ title, author })

  it('finds one book under file names that have nothing in common, as the app compares a book being added', () => {
    const epub = f('/s/Download/book_493.epub', 5)
    const pdf = f('/s/Documents/scan 20240101.pdf', 40)
    const ids = new Map([
      [epub.path, id('גנב הברק', 'ריק ריירדן')],
      [pdf.path, id('גנב הברק', 'ריק ריירדן')],
    ])
    expect(findDuplicateGroups([epub, pdf])).toEqual([])
    const [g] = findDuplicateGroups([epub, pdf], new Set(), ids)
    expect(g!.by).toBe('content')
    expect(g!.keep).toBe(epub)
    expect(g!.versions).toEqual([pdf])
    expect(g!.title).toBe('גנב הברק')
    expect(g!.author).toBe('ריק ריירדן')
  })

  it('matches a series name to the bare title, like the library does, but not two authors or two volumes', () => {
    const a = f('/s/x/aaaa1.epub')
    const b = f('/s/x/bbbb2.pdf')
    expect(findDuplicateGroups([a, b], new Set(), new Map([[a.path, id("פרסי ג'קסון 1 - גנב הברק", 'ריק ריירדן')], [b.path, id('גנב הברק', 'ריק ריירדן')]]))).toHaveLength(1)
    expect(findDuplicateGroups([a, b], new Set(), new Map([[a.path, id('גנב הברק', 'ריק ריירדן')], [b.path, id('גנב הברק', 'מישהו אחר')]]))).toEqual([])
    expect(findDuplicateGroups([a, b], new Set(), new Map([[a.path, id("פרסי ג'קסון 1 - גנב הברק")], [b.path, id("פרסי ג'קסון 2 - גנב הברק")]]))).toEqual([])
  })

  it('ignores a title that says nothing about the book', () => {
    const a = f('/s/x/aaaa1.epub')
    const b = f('/s/x/bbbb2.pdf')
    expect(findDuplicateGroups([a, b], new Set(), new Map([[a.path, id('1~2402 1')], [b.path, id('1~2402 1')]]))).toEqual([])
    expect(findDuplicateGroups([a, b], new Set(), new Map([[a.path, id('ספר')], [b.path, id('ספר')]]))).toEqual([])
  })

  it('keeps naming a group by its files when the names alone made it', () => {
    const [g] = findDuplicateGroups([f('/s/a/ספר ארוך.epub'), f('/s/b/ספר ארוך.pdf')], new Set(), new Map())
    expect(g!.by).toBe('name')
    expect(g!.author).toBe('')
  })
})

describe('findDuplicateGroups in Hebrew', () => {
  it('matches the same book whose author is spelt another way or turned around', () => {
    const a = f('/s/Documents/קורא ספרים/ג\'יי קיי רולינג/הארי פוטר ואבן החכמים.epub')
    const b = f('/s/Download/hp1.epub')
    const ids = new Map([
      [a.path, { title: 'הארי פוטר ואבן החכמים', author: "ג'יי קיי רולינג" }],
      [b.path, { title: 'הארי פוטר ואבן החכמים', author: "רולינג, ג'יי קיי" }],
    ])
    const [g] = findDuplicateGroups([a, b], new Set(), ids)
    expect(g?.by).toBe('content')
    expect(g?.author).toBe("ג'יי קיי רולינג")
  })

  it('reads a file with nothing inside by its name, its author told apart, and ignores invisible marks', () => {
    const a = f('/s/Download/ריק ריירדן - גנב הברק.pdf')
    const b = f('/s/Documents/גנב הברק.epub')
    const ids = new Map([
      [a.path, { title: '', author: '' }],
      [b.path, { title: 'גנב\u200f הברק', author: 'ריק ריירדן' }],
    ])
    const [g] = findDuplicateGroups([a, b], new Set(), ids, ['ריק ריירדן'])
    expect(g?.keep).toBe(b)
    expect(g?.versions).toEqual([a])
  })

  it('sees a download site\'s tag on a name as the same name', () => {
    const groups = findDuplicateGroups([f('/s/Download/גנב הברק (Z-Library).epub'), f('/s/Download/גנב הברק.epub')])
    expect(groups).toHaveLength(1)
  })
})
