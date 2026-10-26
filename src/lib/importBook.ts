import { ImportError, explainImportError } from './errors'
import { contentId, getBookMeta, hasBook, listBooks, mergedInto, replaceBook, saveBook, saveReconverted, type BookMeta, type BookRecord } from './db'
import { sameBook } from './sameBook'
import { t } from '../i18n'
import { wordsOfBook, wordsOfExtracted } from './wordCount'
import { isAudio, readAudioMeta, type AudioInfo } from './audioBook'
import { isDrmEpub, isDrmMobi } from './drm'
import { isScriptedBook } from './sandbox'
import { decodeEntities } from './entities'
import { realAuthor } from './authorName'
import { repairEpub } from './epubRepair'

const ALREADY_EXISTS = t('import.exists')

export const langMap = (v: unknown): string => {
  if (!v) return ''
  if (typeof v === 'string') return decodeEntities(v)
  if (typeof v === 'object') {
    const o = v as Record<string, string>
    return decodeEntities(o.he ?? o.en ?? Object.values(o)[0] ?? '')
  }
  return ''
}

export const contributor = (v: unknown): string => {
  if (!v) return ''
  const arr = Array.isArray(v) ? v : [v]
  return arr
    .map((c) => (typeof c === 'string' ? c : langMap((c as { name?: unknown })?.name)))
    .filter(Boolean)
    .join(', ')
}

const isTxt = (f: File) => /\.txt$/i.test(f.name) || f.type === 'text/plain'
const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'
const isEpub = (f: File) => /\.epub$/i.test(f.name) || f.type === 'application/epub+zip'
const isDocx = (f: File) =>
  /\.docx$/i.test(f.name) || f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
/** formats foliate-js reads as they are: MOBI/AZW/AZW3 (KF8), FictionBook and comic-book zips */
const isNative = (f: File) => /\.(mobi|azw3?|fb2|fbz|fb2\.zip|cbz)$/i.test(f.name)

/** foliate picks CBZ/FB2 by a lowercase file name; give it one whatever case the file arrived in */
const lowerName = (f: File) =>
  f.name === f.name.toLowerCase() ? f : new File([f], f.name.toLowerCase(), { type: f.type })

/** a PDF bigger than this is kept as the PDF itself: converting it to EPUB would take too long and too much memory */
export const LARGE_PDF_BYTES = 20 * 1024 * 1024
/**
 * Version of the PDF→EPUB conversion (lib/pdfToBook), stored on each converted book. Raise it whenever the conversion's text
 * gets better (2: words no longer glued together; 3: each table-of-contents entry on its own line): adding the same PDF again then converts it afresh instead of refusing it.
 */
export const PDF_CONVERSION = 3
/** a text file this big is a whole collection, not a book; converting it would freeze a phone and take hundreds of MB of memory */
export const MAX_TXT_BYTES = 15 * 1024 * 1024

/**
 * Settles at once when the signal aborts, even if the work behind the promise is stuck in a step that
 * cannot be interrupted (parsing, zipping, counting). That work is left to stop at its next checkpoint,
 * and since nothing is saved after an abort, nothing of it remains.
 */
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

/** a cancelled import: the book in progress is dropped, nothing of it is saved */
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/** the failure for a file whose exact content is already in the library */
export const isAlreadyInLibrary = (e: unknown) => e instanceof ImportError && e.message === ALREADY_EXISTS

/** what to do when the library already holds a book with the same title and author */
export type DuplicateChoice = 'replace' | 'add' | 'skip'
export type OnDuplicate = (existing: BookMeta) => Promise<DuplicateChoice | 'defer'>

/** finishes or drops a deferred duplicate; a book converted on import is converted again, so progress and cancelling apply */
type Commit = (choice: DuplicateChoice, onProgress?: (msg: string) => void, signal?: AbortSignal) => Promise<BookRecord | undefined>

/**
 * Thrown when onDuplicate answered 'defer': the book waits for a choice; call commit to finish or drop it.
 * Many can wait at once, so a waiting one holds no opened book and no converted copy, only the file it came from.
 */
export class DeferredDuplicate extends Error {
  existing: BookMeta
  title: string
  commit: Commit
  constructor(existing: BookMeta, title: string, commit: Commit) {
    super('deferred')
    this.name = 'DeferredDuplicate'
    this.existing = existing
    this.title = title
    this.commit = commit
  }
}

/** Adds a book to the library. Failures are rethrown as ImportError with a message fit to show the user. */
export async function importFile(
  file: File,
  onProgress?: (msg: string) => void,
  onDuplicate?: OnDuplicate,
  signal?: AbortSignal,
): Promise<BookRecord> {
  signal?.throwIfAborted()
  if (!file.size) throw new ImportError(t('import.empty'))
  if (!isEpub(file) && !isPdf(file) && !isTxt(file) && !isDocx(file) && !isNative(file) && !isAudio(file))
    throw new ImportError(t('import.unsupported'))
  if (isTxt(file) && file.size > MAX_TXT_BYTES)
    throw new ImportError(t('import.txtTooBig', { mb: Math.round(MAX_TXT_BYTES / 1024 / 1024) }))
  try {
    if (await hasDrm(file)) throw new ImportError(t('err.drm'))
    return await abortable(readIntoLibrary(file, onProgress, onDuplicate, signal), signal)
  } catch (e) {
    if (e instanceof DeferredDuplicate) throw e
    if (signal?.aborted) throw signal.reason // cancelled by the user: not a failure to explain
    console.error(e)
    throw new ImportError(explainImportError(e))
  }
}

/** only DRM-free books are supported; a protected one would otherwise open as gibberish or fail with a vague error */
async function hasDrm(file: File): Promise<boolean> {
  try {
    if (isEpub(file)) return await isDrmEpub(file)
    if (/.(mobi|azw3?)$/i.test(file.name)) return await isDrmMobi(file)
  } catch {
    /* unreadable: let the real import report what is wrong with the file */
  }
  return false
}

async function readIntoLibrary(
  file: File,
  onProgress?: (msg: string) => void,
  onDuplicate?: OnDuplicate,
  signal?: AbortSignal,
): Promise<BookRecord> {
  // Hash the file as the user supplied it (a PDF/TXT conversion isn't guaranteed to be byte-stable).
  const id = await contentId(file)
  signal?.throwIfAborted()
  // a PDF already in the library is refused, unless an older conversion made its book: then it is converted afresh into it
  const existing = await getBookMeta(id)
  const reconvert =
    !!existing && isPdf(file) && file.size <= LARGE_PDF_BYTES && !!(existing.fromPdf || existing.pdf) && (existing.conv ?? 0) < PDF_CONVERSION
  if (existing && !reconvert) throw new ImportError(ALREADY_EXISTS)
  // a file that was merged into another copy of its book (lib/bookCopies) is that book
  const into = await mergedInto(id).catch(() => undefined)
  if (into && (await hasBook(into))) throw new ImportError(ALREADY_EXISTS)

  let epub = file
  let fromPdf = false
  let largePdf = false
  let audio: AudioInfo | undefined
  let cover: Blob | undefined
  let title: string
  let author: string
  let words: number | undefined
  /** words of a book converted from PDF/TXT/DOCX, counted from the text the converter already holds */
  let knownWords: number | undefined
  let scripted: boolean | undefined
  let book: { destroy?: () => void } = {}
  /** a cancel after the book was opened also releases it */
  const check = () => {
    if (signal?.aborted) book.destroy?.()
    signal?.throwIfAborted()
  }

  if (isAudio(file)) {
    onProgress?.(t('import.readingAudio'))
    const m = await readAudioMeta(file)
    audio = m.info
    cover = m.cover
    title = m.title || file.name.replace(/\.[^.]+$/, '')
    author = realAuthor(m.author)
  } else {
  // Converters pull in pdf.js / JSZip, so they load only when an import actually needs them.
  const { makeBook } = await import('foliate-js/view.js')

  if (isPdf(file) && file.size > LARGE_PDF_BYTES) {
    // too big to convert: the PDF itself is kept, which foliate-js shows page by page (no conversion started)
    fromPdf = true
    largePdf = true
    onProgress?.(t('import.pdfLarge'))
  } else if (isPdf(file)) {
    // Convert the PDF into a real EPUB first, then read it exactly like any other EPUB.
    const [{ extractPdf }, { buildEpub }] = await Promise.all([import('./pdfToBook'), import('./pdfToEpub')])
    const x = await extractPdf(
      file,
      file.name,
      (done, total) => onProgress?.(`${t('import.extracting')} ${done}/${total}`),
      signal,
    )
    check()
    fromPdf = true
    if (x.keepOriginal) {
      // a text conversion would wreck the tables (or find no text in a scan): keep the PDF itself, which foliate-js shows page by page
      cover = x.cover
      onProgress?.(t('import.pdfKept'))
    } else {
      onProgress?.(t('import.pdfConverting'))
      knownWords = wordsOfExtracted(x)
      const blob = await buildEpub(x, signal)
      check()
      epub = new File([blob], file.name.replace(/\.pdf$/i, '') + '.epub', { type: 'application/epub+zip' })
    }
  }

  if (isTxt(file)) {
    onProgress?.(t('import.converting'))
    const [{ extractTxt }, { buildEpub }] = await Promise.all([import('./txtToBook'), import('./pdfToEpub')])
    const x = await extractTxt(file, signal)
    knownWords = wordsOfExtracted(x)
    const blob = await buildEpub(x, signal)
    epub = new File([blob], file.name.replace(/\.txt$/i, '') + '.epub', { type: 'application/epub+zip' })
  }

  if (isDocx(file)) {
    onProgress?.(t('import.converting'))
    const [{ extractDocx }, { buildEpub }] = await Promise.all([import('./docxToBook'), import('./pdfToEpub')])
    const x = await extractDocx(file, signal)
    knownWords = wordsOfExtracted(x)
    const blob = await buildEpub(x, signal)
    epub = new File([blob], file.name.replace(/\.docx$/i, '') + '.epub', { type: 'application/epub+zip' })
  }

  check()
  onProgress?.(t('import.reading'))
  if (isNative(file)) epub = lowerName(file)
  else if (isEpub(file)) epub = await repairEpub(file) // an OPF without any metadata would not open
  const opened = await makeBook(epub)
  book = opened
  try {
    cover = (await opened.getCover?.()) ?? cover
  } catch {
    /* no cover */
  }
  title = langMap(opened.metadata?.title) || epub.name.replace(/\.[^.]+$/, '')
  author = realAuthor(contributor(opened.metadata?.author))
  if (!fromPdf) scripted = isScriptedBook(opened)
  if (largePdf) {
    words = 0 // a PDF shown as it is has no text to count
  } else if (knownWords !== undefined) {
    words = knownWords
  } else {
    onProgress?.(t('import.counting'))
    words = await wordsOfBook(opened, signal)
  }
  }
  check()

  if (reconvert && existing) {
    // the same book with a better text: everything the user set on it (name, folder, tags, cover…) stays
    book.destroy?.()
    if (epub === file) throw new ImportError(ALREADY_EXISTS) // kept as the PDF itself (tables, a scan): nothing better to give
    const { pdf: _legacy, cfi: _cfi, fraction: _fraction, lastOpened: _opened, ...meta } = existing
    const rec: BookRecord = { ...meta, kind: 'epub', file: epub, fileName: epub.name, fromPdf: true, conv: PDF_CONVERSION, words, cover: existing.cover ?? cover }
    await saveReconverted(rec)
    return rec
  }

  const dup = (await listBooks()).find((b) => sameBook(b, { title, author }))
  let replaceId: string | undefined
  if (dup) {
    const choice = onDuplicate ? await onDuplicate(dup) : 'skip'
    check()
    if (choice === 'defer') {
      book.destroy?.()
      book = {}
      // a PDF/TXT/DOCX conversion is a new copy in memory: dropped now and made again only if the book is kept
      if (epub !== file && !isNative(file)) {
        epub = file
        cover = undefined
        throw new DeferredDuplicate(dup, title, async (c, progress, sig) =>
          c === 'skip' ? undefined : importFile(file, progress, async () => c, sig),
        )
      }
      throw new DeferredDuplicate(dup, title, async (c) => (c === 'skip' ? undefined : store(c === 'replace' ? dup.id : undefined)))
    }
    if (choice === 'skip') {
      book.destroy?.()
      throw new ImportError(ALREADY_EXISTS)
    }
    if (choice === 'replace') replaceId = dup.id
  }

  return store(replaceId)

  async function store(replaceId: string | undefined): Promise<BookRecord> {
  check() // last chance: once saved, the book stays
  const rec: BookRecord = {
    id,
    file: epub,
    fileName: epub.name,
    addedAt: Date.now(),
    kind: audio ? 'audio' : 'epub',
    fromPdf,
    ...(fromPdf && !largePdf && epub !== file && { conv: PDF_CONVERSION }),
    audio,
    words,
    scripted,
    title,
    author,
    cover,
  }
  book.destroy?.()
  if (replaceId) await replaceBook(replaceId, rec)
  else await saveBook(rec)
  return rec
  }
}
