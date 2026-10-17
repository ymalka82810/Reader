import { describe, expect, it } from 'vitest'
import { buildMarkdown, buildObsidian, buildPrintHtml, safeFileName, type ExportNote } from './notesExport'

const labels = { highlights: 'Highlights', bookmarks: 'Bookmarks', exportedOn: 'Exported' }
const hl: ExportNote = { kind: 'highlight', text: 'To be,\nor not', note: 'Famous', color: '#f2c744', colorName: 'yellow', chapter: 'Act 3', percent: 42, createdAt: 0 }
const bm: ExportNote = { kind: 'bookmark', text: 'Act 1 · 5%', color: '', colorName: '', chapter: '', percent: 5, createdAt: 0 }

describe('notes export', () => {
  it('markdown has quote, location and colour', () => {
    const md = buildMarkdown('Hamlet', [hl, bm], labels)
    expect(md).toContain('> To be, or not')
    expect(md).toContain('— Act 3 · 42% · yellow')
    expect(md).toContain('Famous')
    expect(md).toContain('- Act 1 · 5%')
  })

  it('obsidian has properties, a callout and a colour tag', () => {
    const md = buildObsidian('Ha"mlet', [hl], labels, Date.UTC(2026, 0, 2))
    expect(md.startsWith('---\ntitle: "Ha\\"mlet"')).toBe(true)
    expect(md).toContain('exported: 2026-01-02')
    expect(md).toContain('> [!quote] Act 3 · 42%')
    expect(md).toContain('> #highlight/yellow')
  })

  it('print html escapes text and keeps the colour', () => {
    const html = buildPrintHtml('<b>', [{ ...hl, text: '<script>' }], labels, 'rtl')
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('#f2c744')
  })

  it('file names drop forbidden characters', () => {
    expect(safeFileName('a/b:c', 'x')).toBe('a_b_c')
    expect(safeFileName('  ', 'x')).toBe('x')
  })
})
