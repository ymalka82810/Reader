import { describe, expect, it } from 'vitest'
import { DEFAULT_PDF_OPTIONS, sanitizePdfOptions } from './pdfOptions'

describe('pdf options', () => {
  it('keeps valid choices and falls back to the default for anything else', () => {
    expect(sanitizePdfOptions({ font: 'david', size: 13, indent: 0, spacing: 1.8 })).toEqual({ font: 'david', size: 13, indent: 0, spacing: 1.8 })
    expect(sanitizePdfOptions({ font: 'comic', size: 99, indent: 'x', spacing: null })).toEqual(DEFAULT_PDF_OPTIONS)
    expect(sanitizePdfOptions(undefined)).toEqual(DEFAULT_PDF_OPTIONS)
  })
})
