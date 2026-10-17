import { describe, expect, it } from 'vitest'
import { bookCSS, loadSettings, themeColors } from './settings'

describe('typography settings', () => {
  it('uses the custom colors for the custom theme', () => {
    const s = { ...loadSettings(), theme: 'custom' as const, customBg: '#010203', customFg: '#040506' }
    expect(themeColors(s)).toMatchObject({ bg: '#010203', fg: '#040506' })
    expect(bookCSS(s)).toContain('#010203')
  })

  it('applies letter spacing and the uploaded font only when set', () => {
    const s = loadSettings()
    expect(bookCSS(s)).not.toContain('letter-spacing')
    expect(bookCSS({ ...s, letterSpacing: 0.08 })).toContain('letter-spacing: 0.08em')
    const css = bookCSS({ ...s, fontFamily: 'custom' }, '@font-face{}')
    expect(css).toContain('ReaderCustomFont')
    expect(bookCSS({ ...s, fontFamily: 'custom' })).not.toContain('ReaderCustomFont')
  })
})
