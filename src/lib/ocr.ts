import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Line } from './pdfLayout'

/** Rendered page height handed to the OCR engine, in px (roughly 300 dpi for an A4 page). */
const TARGET_HEIGHT = 2400
/** Lines the engine itself is unsure about are almost always noise from images or smudges. */
const MIN_CONFIDENCE = 30

interface OcrLine {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/** Short lines the engine is only moderately sure about are mostly specks and page edges read as letters. */
const SHORT_LINE = 3
const SHORT_LINE_CONFIDENCE = 70

/** True for OCR output that is clearly not text: symbols only, mostly symbols, or a stray short fragment. */
export function isOcrNoise(text: string, confidence: number): boolean {
  const chars = text.replace(/\s/g, '')
  const letters = (chars.match(/[\p{L}\p{N}]/gu) ?? []).length
  if (!letters) return true
  if (chars.length >= 4 && letters < chars.length * 0.5) return true
  return chars.length <= SHORT_LINE && confidence < SHORT_LINE_CONFIDENCE
}

/**
 * Convert OCR output (pixel boxes, origin top-left) into the same `Line` shape pdf.js text gives,
 * where y grows upwards, so everything downstream treats scanned and digital pages alike.
 */
export function ocrLinesToLines(lines: OcrLine[], pageHeight: number): Line[] {
  return lines
    .filter((l) => l.confidence >= MIN_CONFIDENCE)
    .filter((l) => !isOcrNoise(l.text, l.confidence))
    .map((l) => ({
      text: l.text.replace(/\s+/g, ' ').trim(),
      y: pageHeight - l.bbox.y1,
      h: l.bbox.y1 - l.bbox.y0,
      x0: l.bbox.x0,
      x1: l.bbox.x1,
    }))
    .filter((l) => l.text)
}

/**
 * Run OCR over the given pages (1-based) of a PDF, e.g. the ones with no text layer. Resolves to
 * the lines of each page, in the order given; progress counts only these pages. Tesseract.js (and
 * its Hebrew + English models, fetched once and then cached by the library) is loaded only when
 * this is called.
 */
export async function ocrPdf(
  pdf: PDFDocumentProxy,
  pageNumbers: number[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Line[][]> {
  signal?.throwIfAborted()
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(['heb', 'eng'])
  // a cancel stops the page being read at once, instead of waiting for it to finish
  const stop = () => void worker.terminate().catch(() => {})
  signal?.addEventListener('abort', stop, { once: true })
  const canvas = document.createElement('canvas')
  const pages: Line[][] = []
  try {
    for (const [n, i] of pageNumbers.entries()) {
      signal?.throwIfAborted()
      onProgress?.(n, pageNumbers.length)
      const page = await pdf.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: TARGET_HEIGHT / base.height })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport }).promise
      page.cleanup()
      const { data } = await worker.recognize(canvas, {}, { blocks: true }).catch((e) => {
        signal?.throwIfAborted() // the worker was terminated by the cancel: report that, not the failed read
        throw e
      })
      const found = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      pages.push(ocrLinesToLines(found, canvas.height))
    }
    onProgress?.(pageNumbers.length, pageNumbers.length)
  } finally {
    signal?.removeEventListener('abort', stop)
    canvas.width = canvas.height = 0
    await worker.terminate().catch(() => {})
  }
  return pages
}
