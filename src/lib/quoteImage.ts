import { FONTS } from './settings'

/** greedy word wrap; a word wider than the line is split by characters */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  for (const para of text.split(/\n+/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (!line || measure(next) <= maxWidth) {
        line = next
        continue
      }
      lines.push(line)
      line = word
    }
    // a lone word can still be wider than the image: break it
    for (const chunk of splitWide(line, maxWidth, measure)) lines.push(chunk)
  }
  return lines
}

function splitWide(word: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (measure(word) <= maxWidth) return [word]
  const out: string[] = []
  let cur = ''
  for (const ch of word) {
    if (cur && measure(cur + ch) > maxWidth) {
      out.push(cur)
      cur = ''
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

const WIDTH = 1080
const PAD = 96

export interface QuoteImageOptions {
  /** the quoted passage, without quotation marks: they are added here */
  text: string
  /** who or what the quote is credited to: the book's title or the speaker; empty = no credit line */
  credit: string
  colors: { bg: string; fg: string }
  /** key of FONTS */
  fontFamily: string
}

/** draws the quote, in quotation marks, with its credit line underneath, and returns it as a PNG */
export async function renderQuoteImage({ text, credit, colors, fontFamily }: QuoteImageOptions): Promise<Blob> {
  const rtl = /[֐-׿؀-ۿ]/.test(text)
  const family = FONTS[fontFamily]?.family || FONTS.serif?.family || 'serif'
  const quote = `“${text.trim().replace(/\s+/g, ' ')}”`
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.direction = rtl ? 'rtl' : 'ltr'

  const inner = WIDTH - PAD * 2
  let size = quote.length > 700 ? 30 : quote.length > 400 ? 38 : quote.length > 220 ? 48 : 60
  let lines: string[] = []
  for (; ; size -= 2) {
    ctx.font = `${size}px ${family}`
    lines = wrapLines(quote, inner, (s) => ctx.measureText(s).width)
    if (lines.length * size * 1.5 <= 1500 || size <= 24) break
  }
  const lineH = size * 1.5
  const creditSize = Math.max(28, Math.round(size * 0.6))
  const creditText = credit.trim() ? `— ${credit.trim()}` : ''
  const body = lines.length * lineH
  const height = Math.max(WIDTH, Math.ceil(PAD * 2 + body + (creditText ? creditSize * 2.4 : 0)))
  canvas.width = WIDTH
  canvas.height = height
  // resizing resets the context state
  ctx.direction = rtl ? 'rtl' : 'ltr'
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, WIDTH, height)
  ctx.fillStyle = colors.fg
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = rtl ? 'right' : 'left'
  const x = rtl ? WIDTH - PAD : PAD

  const contentH = body + (creditText ? creditSize * 2.4 : 0)
  let y = (height - contentH) / 2 + size * 1.1
  ctx.font = `${size}px ${family}`
  for (const l of lines) {
    ctx.fillText(l, x, y)
    y += lineH
  }
  if (creditText) {
    ctx.globalAlpha = 0.7
    ctx.font = `${creditSize}px ${family}`
    ctx.fillText(creditText, x, y + creditSize * 0.9)
    ctx.globalAlpha = 1
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image failed'))), 'image/png'),
  )
}
