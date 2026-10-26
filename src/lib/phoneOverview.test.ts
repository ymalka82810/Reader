import { describe, expect, it } from 'vitest'
import { findDuplicateGroups } from './phoneDuplicates'
import { summarizePhone } from './phoneOverview'

const f = (path: string, size = 10) => ({ path, name: path.split('/').pop()!, size, modified: 1 })

describe('summarizePhone', () => {
  const files = [
    f('/s/Documents/קורא ספרים/מחבר/ספר ארוך.epub', 5),
    f('/s/Documents/קורא ספרים/מחבר/גרסאות/PDF/ספר ארוך.pdf', 20),
    f('/s/Download/ספר ארוך.pdf', 20),
    f('/s/Download/ספר ארוך (1).pdf', 15),
    f('/s/Download/אחר.mobi', 7),
  ]

  it('counts files, formats and where they are', () => {
    const o = summarizePhone(files, new Set([files[0]!.path, '/s/gone/x.epub']), findDuplicateGroups(files))
    expect(o.files).toBe(5)
    expect(o.bytes).toBe(67)
    expect(o.byFormat[0]).toEqual({ ext: 'pdf', count: 3, bytes: 55 })
    expect(o.inBooksFolder).toBe(1)
    expect(o.versions).toBe(1)
    expect(o.outside).toBe(3)
    expect(o.tracked).toBe(1)
    expect(o.untracked).toBe(3)
    expect(o.missing).toBe(1)
  })

  it('counts the duplicates and the room the surplus takes', () => {
    const o = summarizePhone(files, new Set(), findDuplicateGroups(files))
    expect(o.duplicateGroups).toBe(1)
    expect(o.surplusFiles).toBe(1)
    expect(o.surplusBytes).toBe(15)
  })

  it('is all zeros for an empty phone', () => {
    const o = summarizePhone([], new Set(), [])
    expect([o.files, o.bytes, o.byFormat.length, o.missing, o.duplicateGroups]).toEqual([0, 0, 0, 0, 0])
  })
})
