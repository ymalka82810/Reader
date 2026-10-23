// Reading the text of an image (a scanned page, a cover) on the device: Tesseract.js with the Hebrew and English models,
// all of it shipped with the app (see `tesseractAssets` in vite.config.ts), so nothing is fetched from another site and
// the image never leaves the phone. It is loaded only when a book has no text of its own to be identified by.

/** a line of text is kept when it holds at least this many letters and the engine is at least this sure of it */
const MIN_LETTERS = 2
const MIN_CONFIDENCE = 55

interface OcrLine {
  text: string
  confidence: number
  /** where the line stands in the image: its height is the size of its letters */
  bbox?: { x0: number; y0: number; x1: number; y1: number }
}

const url = (path: string) => new URL(path, document.baseURI).href

/** the lines worth keeping, in reading order: a smudge or a decoration read as a few random characters is dropped */
export function cleanLines(lines: OcrLine[]): string[] {
  return lines
    .filter((l) => l.confidence >= MIN_CONFIDENCE && (l.text.match(/[א-תA-Za-z]/g)?.length ?? 0) >= MIN_LETTERS)
    .map((l) => l.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** The lines of a cover, the largest letters first: on a cover the title is set larger than anything else, then
 *  the author or the series, and the small print (the publisher, a review) last. Lines of letters as large as each
 *  other keep their order on the cover. */
export function bySize(lines: OcrLine[]): string[] {
  const height = (l: OcrLine) => (l.bbox ? l.bbox.y1 - l.bbox.y0 : 0)
  const kept = lines.filter((l) => l.confidence >= MIN_CONFIDENCE && (l.text.match(/[א-תA-Za-z]/g)?.length ?? 0) >= MIN_LETTERS)
  return kept
    .map((l, i) => ({ l, i, h: height(l) }))
    .sort((a, b) => (Math.abs(b.h - a.h) > Math.max(a.h, b.h) * 0.15 ? b.h - a.h : a.i - b.i))
    .map(({ l }) => l.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

type OcrSource = HTMLCanvasElement | Blob

/** The text lines of each image (a canvas or an image file), Hebrew and English together, one list per image. An image
 *  may be given as a function, which is called only when its turn comes (a PDF page is drawn then, not all at once).
 *  Rejects when `signal` aborts; an engine that cannot start (no wasm support, a missing file) rejects too, and the
 *  caller carries on without it. */
export async function ocrLines(
  images: (OcrSource | (() => Promise<OcrSource>))[],
  signal?: AbortSignal,
  /** how the lines of each image are kept: in reading order (cleanLines), or the largest first (bySize) */
  keep: (lines: OcrLine[]) => string[] = cleanLines,
): Promise<string[][]> {
  signal?.throwIfAborted()
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(['heb', 'eng'], 1, {
    workerPath: url('tesseract/worker.min.js'),
    corePath: url('tesseract/core'),
    langPath: url('tesseract/lang'),
    // the worker is a file of the app itself, so it needs no blob: wrapper
    workerBlobURL: false,
    // the Android build unpacks every .gz asset and drops the extension (lang/heb.traineddata), so the app reads the plain files
    gzip: !(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
  })
  const stop = () => void worker.terminate().catch(() => {})
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const out: string[][] = []
    for (const image of images) {
      signal?.throwIfAborted()
      const source = typeof image === 'function' ? await image() : image
      const { data } = await worker.recognize(source, {}, { blocks: true })
      signal?.throwIfAborted()
      out.push(keep((data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))))
    }
    return out
  } finally {
    signal?.removeEventListener('abort', stop)
    stop()
  }
}
