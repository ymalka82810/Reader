// What a reader can set for the PDF of a book: the font, its size, the indent of a paragraph's first line, the leading.

export type PdfFontKey = 'heebo' | 'assistant' | 'frank' | 'david' | 'miriam' | 'custom'

export interface PdfOptions {
  font: PdfFontKey
  /** body text size, in points */
  size: number
  /** the first line of a paragraph, in em */
  indent: number
  /** line height, as a multiple of the size */
  spacing: number
}

export const PDF_FONT_LABELS: Record<Exclude<PdfFontKey, 'custom'>, string> = {
  heebo: 'Heebo',
  assistant: 'Assistant',
  frank: 'Frank Ruhl Libre',
  david: 'David Libre',
  miriam: 'Miriam Libre',
}

export const PDF_SIZES = [10, 11.5, 13, 15]
export const PDF_INDENTS = [0, 1, 1.5, 2.5]
export const PDF_SPACINGS = [1.3, 1.55, 1.8, 2.1]

export const DEFAULT_PDF_OPTIONS: PdfOptions = { font: 'heebo', size: 11.5, indent: 1.5, spacing: 1.55 }

const KEY = 'reader.pdfOptions'
const pick = <T,>(v: unknown, list: T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)

/** options read back from storage: anything unknown falls back to the default */
export function sanitizePdfOptions(v: unknown): PdfOptions {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  const d = DEFAULT_PDF_OPTIONS
  return {
    font: pick(o.font, ['heebo', 'assistant', 'frank', 'david', 'miriam', 'custom'] as PdfFontKey[], d.font),
    size: pick(o.size, PDF_SIZES, d.size),
    indent: pick(o.indent, PDF_INDENTS, d.indent),
    spacing: pick(o.spacing, PDF_SPACINGS, d.spacing),
  }
}

export function loadPdfOptions(): PdfOptions {
  try {
    return sanitizePdfOptions(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return DEFAULT_PDF_OPTIONS
  }
}

export function savePdfOptions(o: PdfOptions) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o))
  } catch {
    /* storage unavailable or full: the choice just won't be remembered */
  }
}
