import { t } from '../i18n'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { buildLines, looksTabular, normalizeStreamOrder, rawItems, readingGroups, type Line } from './pdfLayout'
import { detectHeadings, isBlankPixels, isPoorPage, joinPages, stripRunningLines, toParagraphs, visualOrder } from './pdfText'

const PAGES_PER_SECTION = 8
/** a page with less text than this is treated as an image (a scan) */
const MIN_PAGE_CHARS = 20

export interface ExtractedPdf {
  title: string
  author: string
  rtl: boolean
  pageCount: number
  /** one entry per future EPUB chapter: a real heading when found, else a page range */
  chapters: {
    title: string
    paras: string[]
    /** images of the original pages the text conversion handled badly, shown after the chapter's text */
    pageImages?: PageImage[]
  }[]
  /** the first page rendered as a JPEG, used as the book's cover */
  cover?: Blob
  /** the PDF has tables or is a scan, which a text conversion would wreck or can't read: the original file is kept instead */
  keepOriginal?: boolean
}

interface PageImage {
  /** 1-based page number in the PDF */
  page: number
  image: Blob
}

const COVER_HEIGHT = 900
/** how many opening pages are tried for a cover before giving up on a blank-looking start */
const COVER_SEARCH_PAGES = 3
const PAGE_IMAGE_HEIGHT = 1100
/** keeps the EPUB (and the library in IndexedDB) from ballooning on a long, badly converted PDF */
const MAX_PAGE_IMAGES = 120


/** Checked on a downscaled copy: cheap, and a line of text still leaves a non-white pixel. */
function isBlankCanvas(canvas: HTMLCanvasElement): boolean {
  const small = document.createElement('canvas')
  small.width = 48
  small.height = Math.max(1, Math.round((48 * canvas.height) / canvas.width))
  const ctx = small.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(canvas, 0, 0, small.width, small.height)
  return isBlankPixels(ctx.getImageData(0, 0, small.width, small.height).data)
}

/** Render one page as a JPEG of the given height; null when rendering isn't possible (or, with skipBlank, the page came out blank). */
async function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  height: number,
  quality: number,
  skipBlank = false,
): Promise<Blob | null> {
  try {
    const page = await pdf.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: height / base.height })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, viewport }).promise
    page.cleanup()
    if (skipBlank && isBlankCanvas(canvas)) {
      canvas.width = canvas.height = 0
      return null
    }
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality))
    canvas.width = canvas.height = 0
    return blob
  } catch (e) {
    console.error(e)
    return null
  }
}

/** The first of the opening pages that isn't blank; none when they all are, so the library shows the title instead of a white page. */
async function renderCover(pdf: PDFDocumentProxy): Promise<Blob | null> {
  for (let i = 1; i <= Math.min(COVER_SEARCH_PAGES, pdf.numPages); i++) {
    const cover = await renderPage(pdf, i, COVER_HEIGHT, 0.85, true)
    if (cover) return cover
  }
  return null
}

/** Legacy: books imported before the PDF→EPUB conversion store ready-made HTML sections. */
export interface LegacyPdfBook {
  title: string
  author: string
  rtl: boolean
  pageCount: number
  sections: string[]
}

const pageRange = (from: number, to: number) => (from === to ? t('pdf.page', { n: from }) : t('pdf.pages', { from, to }))

/** Chapter start pages (0-based) taken from the PDF's own bookmarks, if it has any. */
async function outlineStarts(pdf: PDFDocumentProxy): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  try {
    const outline = await pdf.getOutline()
    if (!outline?.length) return out
    const walk = async (items: typeof outline, depth: number) => {
      for (const it of items) {
        try {
          let dest = it.dest
          if (typeof dest === 'string') dest = await pdf.getDestination(dest)
          const ref = Array.isArray(dest) ? dest[0] : null
          const page = ref == null ? -1 : typeof ref === 'number' ? ref : await pdf.getPageIndex(ref)
          const title = it.title.replace(/\s+/g, ' ').trim()
          if (page >= 0 && title && !out.has(page)) out.set(page, title)
        } catch {
          /* unresolvable bookmark: skip */
        }
        if (depth < 2 && it.items?.length) await walk(it.items, depth + 1)
      }
    }
    await walk(outline, 1)
  } catch {
    /* no outline */
  }
  return out
}

/** Extract the text of a PDF as paragraphs, grouped into chapters. */
export async function extractPdf(
  file: Blob,
  fileName: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ExtractedPdf> {
  signal?.throwIfAborted()
  // pdf.js is heavy; load it only when a PDF is actually imported.
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    // JPEG2000 (common in scanned covers) and JBIG2 images are decoded by wasm that pdf.js loads from here
    wasmUrl: new URL('pdfjs-wasm/', document.baseURI).href,
  })
  // a cancel tears the document down at once, which also makes whatever page is being read fail fast
  const stopTask = () => void task.destroy().catch(() => {})
  signal?.addEventListener('abort', stopTask, { once: true })
  let pdf: PDFDocumentProxy
  try {
    pdf = await task.promise
  } catch (e) {
    signal?.removeEventListener('abort', stopTask)
    signal?.throwIfAborted()
    throw e
  }
  const total = pdf.numPages
  let pages: Line[][] = []
  let info: Record<string, string>
  let bookmarks: Map<number, string>
  let cover: Blob | null = null
  let hasTables = false
  const pageImages = new Map<number, Blob>()
  try {
    for (let i = 1; i <= total; i++) {
      signal?.throwIfAborted()
      const p = await pdf.getPage(i)
      const items = normalizeStreamOrder(await rawItems(p))
      if (looksTabular(items)) hasTables = true
      pages.push(readingGroups(items).flatMap(buildLines))
      p.cleanup()
      onProgress?.(i, total)
    }
    info = ((await pdf.getMetadata().catch(() => null))?.info ?? {}) as Record<string, string>
    bookmarks = await outlineStarts(pdf)
    signal?.throwIfAborted()
    cover = await renderCover(pdf)
    const charCount = (lines: Line[]) => lines.map((l) => l.text).join('').replace(/\s/g, '').length
    // a scan has no text layer (at least half the pages are images)
    const isScan = pages.filter((lines) => charCount(lines) < MIN_PAGE_CHARS).length >= total / 2
    // tables and scans are shown from the original PDF: no text to convert or render page images for
    if (hasTables || isScan) {
      return {
        title: info.Title || fileName.replace(/\.pdf$/i, ''),
        author: info.Author || '',
        rtl: false,
        pageCount: total,
        chapters: [],
        cover: cover ?? undefined,
        keepOriginal: true,
      }
    }

    // pages whose text came out badly keep a picture of the original page next to it
    const poor = pages.flatMap((lines, i) => (isPoorPage(lines) ? [i] : []))
    for (const i of poor.slice(0, MAX_PAGE_IMAGES)) {
      signal?.throwIfAborted()
      const img = await renderPage(pdf, i + 1, PAGE_IMAGE_HEIGHT, 0.7)
      if (img) pageImages.set(i, img)
    }
  } catch (e) {
    signal?.throwIfAborted() // pages failing because the document was torn down: a cancel, not a bad file
    throw e
  } finally {
    signal?.removeEventListener('abort', stopTask)
    await task.destroy()
  }

  const chars = pages.flat().map((l) => l.text).join('')

  const reversed = visualOrder(pages)
  const hebCount = (chars.match(/[֐-׿]/g) ?? []).length
  const rtl = hebCount > chars.length * 0.3

  // repeated headers/footers would otherwise leak into the text and fake chapter headings
  const body = stripRunningLines(pages)
  const chapterParas = (from: number, to: number) =>
    joinPages(body.slice(from, to).map((p) => toParagraphs(p, reversed)))
  const chapterImages = (from: number, to: number): PageImage[] | undefined => {
    const out: PageImage[] = []
    for (let i = from; i < to; i++) {
      const image = pageImages.get(i)
      if (image) out.push({ page: i + 1, image })
    }
    return out.length ? out : undefined
  }

  let starts = bookmarks
  if (starts.size < 2) starts = detectHeadings(body, reversed)

  const chapters: ExtractedPdf['chapters'] = []
  if (starts.size >= 2) {
    const marks = [...starts.keys()].sort((a, b) => a - b)
    if ((marks[0] ?? 0) > 0) {
      marks.unshift(0)
      starts = new Map(starts).set(0, info.Title || fileName.replace(/\.pdf$/i, ''))
    }
    marks.forEach((from, i) => {
      const to = marks[i + 1] ?? total
      chapters.push({
        title: starts.get(from) ?? pageRange(from + 1, to),
        paras: chapterParas(from, to),
        pageImages: chapterImages(from, to),
      })
    })
  } else {
    for (let start = 0; start < total; start += PAGES_PER_SECTION) {
      const end = Math.min(total, start + PAGES_PER_SECTION)
      chapters.push({
        title: pageRange(start + 1, end),
        paras: chapterParas(start, end),
        pageImages: chapterImages(start, end),
      })
    }
  }
  return {
    title: info.Title || fileName.replace(/\.pdf$/i, ''),
    author: info.Author || '',
    rtl,
    pageCount: total,
    chapters,
    cover: cover ?? undefined,
    keepOriginal: false,
  }
}

/** Legacy: wrap stored HTML sections in the minimal "book" interface foliate-js renders. */
export function bookFromSections(x: LegacyPdfBook) {
  const urls = new Map<number, string>()
  const sections = x.sections.map((html, i) => ({
    id: `s${i}`,
    size: new Blob([html]).size,
    load: () => {
      if (!urls.has(i)) urls.set(i, URL.createObjectURL(new Blob([html], { type: 'text/html' })))
      return urls.get(i)
    },
    unload: () => {
      const u = urls.get(i)
      if (u) URL.revokeObjectURL(u)
      urls.delete(i)
    },
    createDocument: () => new DOMParser().parseFromString(html, 'text/html'),
  }))
  const book: any = {}
  book.metadata = { title: x.title, author: x.author, language: x.rtl ? 'he' : 'en' }
  book.dir = x.rtl ? 'rtl' : 'ltr'
  book.sections = sections
  book.toc = sections.map((s, i) => ({
    label: t('pdf.pages', { from: i * PAGES_PER_SECTION + 1, to: Math.min(x.pageCount, (i + 1) * PAGES_PER_SECTION) }),
    href: s.id,
  }))
  book.resolveHref = (href: string) => ({ index: sections.findIndex((s) => s.id === href) })
  book.splitTOCHref = (href: string) => [href, null]
  book.getTOCFragment = (doc: Document) => doc.documentElement
  book.destroy = () => urls.forEach((u) => URL.revokeObjectURL(u))
  return book
}