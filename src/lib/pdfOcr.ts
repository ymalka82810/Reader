// Reading a scanned PDF (one kept as the PDF itself because it has no text) by OCR, on request: every page is read on the
// device, and the book is replaced by a real EPUB of that text, so it can be searched, highlighted and resized like any other.
import { t } from '../i18n'
import { getBook, saveReconverted, type BookRecord } from './db'
import { PDF_CONVERSION } from './importBook'
import type { ExtractedPdf } from './pdfToBook'
import { wordsOfExtracted } from './wordCount'

const OCR_WIDTH = 1600
const PAGES_PER_SECTION = 8
/** a line shorter than this share of the longest line, ending a sentence, ends its paragraph too */
const SHORT_LINE = 0.7

/** a book kept as the PDF itself (a scan, tables, a very large file), which OCR can turn into text */
export const isKeptPdf = (b: { fromPdf?: boolean; fileName: string }) => !!b.fromPdf && /\.pdf$/i.test(b.fileName)

/** Page lines joined into paragraphs: a line carries on into the next unless it is short and ends a sentence. */
export function linesToParagraphs(lines: string[]): string[] {
  const longest = Math.max(0, ...lines.map((l) => l.length))
  const paras: string[] = []
  let cur = ''
  for (const line of lines) {
    cur = cur ? `${cur.replace(/-$/, '')}${/-$/.test(cur) ? '' : ' '}${line}` : line
    if (/[.!?:״"”׃]$/.test(line) && line.length < longest * SHORT_LINE) {
      paras.push(cur)
      cur = ''
    }
  }
  if (cur) paras.push(cur)
  return paras
}

/** the pages of a PDF read by OCR, as the text the EPUB builder takes; rejects when `signal` aborts or OCR cannot run */
async function ocrPdf(
  file: Blob,
  title: string,
  author: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ExtractedPdf> {
  const [pdfjs, { default: workerUrl }, { ocrLines }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    import('./ocr'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    wasmUrl: new URL('pdfjs-wasm/', document.baseURI).href,
  })
  const stopTask = () => void task.destroy().catch(() => {})
  signal?.addEventListener('abort', stopTask, { once: true })
  try {
    const pdf = await task.promise
    const total = pdf.numPages
    const draw = (n: number) => async () => {
      const page = await pdf.getPage(n)
      try {
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: OCR_WIDTH / base.width })
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        await page.render({ canvas, viewport }).promise
        onProgress(n, total)
        return canvas
      } finally {
        page.cleanup()
      }
    }
    const pages = (await ocrLines(Array.from({ length: total }, (_, i) => draw(i + 1)), signal)).map(linesToParagraphs)
    onProgress(total, total)
    const text = pages.flat().join('')
    if (!text.trim()) throw new Error(t('pdf.ocrNoText'))
    const rtl = (text.match(/[֐-׿]/g)?.length ?? 0) > text.length * 0.3
    const chapters: ExtractedPdf['chapters'] = []
    for (let start = 0; start < total; start += PAGES_PER_SECTION) {
      const end = Math.min(total, start + PAGES_PER_SECTION)
      chapters.push({
        title: end === start + 1 ? t('pdf.page', { n: end }) : t('pdf.pages', { from: start + 1, to: end }),
        paras: pages.slice(start, end).flat(),
      })
    }
    return { title, author, rtl, pageCount: total, chapters: chapters.filter((c) => c.paras.length) }
  } catch (e) {
    signal?.throwIfAborted() // pages failing because the document was torn down: a cancel, not a bad file
    throw e
  } finally {
    signal?.removeEventListener('abort', stopTask)
    await task.destroy().catch(() => {})
  }
}

/** Replaces a kept PDF book with an EPUB of its OCR text; name, folder, tags, cover and notes stay, and the reading
 *  position keeps only how far in the reader was. */
export async function ocrBook(id: string, onProgress: (done: number, total: number) => void, signal?: AbortSignal) {
  const book = await getBook(id)
  if (!book || !isKeptPdf(book)) throw new Error(t('pdf.ocrNotPdf'))
  const [x, { buildEpub }] = await Promise.all([ocrPdf(book.file, book.title, book.author, onProgress, signal), import('./pdfToEpub')])
  const blob = await buildEpub(x, signal)
  signal?.throwIfAborted()
  const epub = new File([blob], book.fileName.replace(/\.pdf$/i, '') + '.epub', { type: 'application/epub+zip' })
  const { file: _pdf, cfi: _cfi, fraction: _fraction, ...meta } = book
  const rec: BookRecord = { ...meta, kind: 'epub', file: epub, fileName: epub.name, fromPdf: true, conv: PDF_CONVERSION, words: wordsOfExtracted(x) }
  await saveReconverted(rec)
}
