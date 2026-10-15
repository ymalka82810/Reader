import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Line } from './pdfToBook'

/** Rendered page height handed to the OCR engine, in px (roughly 300 dpi for an A4 page). */
const TARGET_HEIGHT = 2400
/** Lines the engine itself is unsure about are almost always noise from images or smudges. */
const MIN_CONFIDENCE = 30

interface OcrLine {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * Convert OCR output (pixel boxes, origin top-left) into the same `Line` shape pdf.js text gives,
 * where y grows upwards, so everything downstream treats scanned and digital pages alike.
 */
export function ocrLinesToLines(lines: OcrLine[], pageHeight: number): Line[] {
  return lines
    .filter((l) => l.confidence >= MIN_CONFIDENCE)
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
 * Run OCR over every page of a PDF that has no text layer. Tesseract.js (and its Hebrew + English
 * models, fetched once and then cached by the library) is loaded only when this is called.
 */
export async function ocrPdf(
  pdf: PDFDocumentProxy,
  onProgress?: (done: number, total: number) => void,
): Promise<Line[][]> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(['heb', 'eng'])
  const canvas = document.createElement('canvas')
  const pages: Line[][] = []
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.(i - 1, pdf.numPages)
      const page = await pdf.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: TARGET_HEIGHT / base.height })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport }).promise
      page.cleanup()
      const { data } = await worker.recognize(canvas, {}, { blocks: true })
      const found = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      pages.push(ocrLinesToLines(found, canvas.height))
    }
    onProgress?.(pdf.numPages, pdf.numPages)
  } finally {
    canvas.width = canvas.height = 0
    await worker.terminate()
  }
  return pages
}
