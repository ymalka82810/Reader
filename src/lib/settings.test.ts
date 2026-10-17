// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyA11yClasses, bookCSS, loadSettings, themeColors } from './settings'

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

  it('high contrast overrides every theme in the book', () => {
    const s = { ...loadSettings(), theme: 'sepia' as const, contrast: true }
    expect(themeColors(s)).toEqual({ bg: '#000000', fg: '#ffffff', link: '#ffff00' })
    expect(bookCSS(s)).toContain('underline')
    expect(bookCSS({ ...s, contrast: false })).not.toContain('underline')
  })

  it('the dyslexia font brings its font faces and wider spacing into the book', () => {
    const s = { ...loadSettings(), dyslexia: true, letterSpacing: 0 }
    const css = bookCSS(s)
    expect(css).toContain('@font-face')
    expect(css).toContain('OpenDyslexic')
    expect(css).toContain('letter-spacing: 0.05em')
    expect(bookCSS({ ...s, dyslexia: false })).not.toContain('OpenDyslexic')
  })

  it('mirrors contrast and dyslexia as classes on <html>', () => {
    applyA11yClasses({ contrast: true, dyslexia: true })
    expect(document.documentElement.classList.contains('hc')).toBe(true)
    expect(document.documentElement.classList.contains('dyslexia')).toBe(true)
    applyA11yClasses({ contrast: false, dyslexia: false })
    expect(document.documentElement.classList.contains('hc')).toBe(false)
    expect(document.documentElement.classList.contains('dyslexia')).toBe(false)
  })
})
