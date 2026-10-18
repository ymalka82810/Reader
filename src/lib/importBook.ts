import { ImportError, explainImportError } from './errors'
import { contentId, hasBook, listBooks, replaceBook, saveBook, type BookMeta, type BookRecord } from './db'
import { sameBook } from './sameBook'
import { t } from '../i18n'
import { isAudio, readAudioMeta, type AudioInfo } from './audioBook'

const ALREADY_EXISTS = t('import.exists')

const langMap = (v: unknown): string => {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    const o = v as Record<string, string>
    return o.he ?? o.en ?? Object.values(o)[0] ?? ''
  }
  return ''
}

const contributor = (v: unknown): string => {
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

/** what to do when the library already holds a book with the same title and author */
export type DuplicateChoice = 'replace' | 'add' | 'skip'
export type OnDuplicate = (existing: BookMeta) => Promise<DuplicateChoice | 'defer'>

/** Thrown when onDuplicate answered 'defer': the book is parsed and waiting; call commit to finish or drop it. */
export class DeferredDuplicate extends Error {
  existing: BookMeta
  title: string
  commit: (choice: DuplicateChoice) => Promise<BookRecord | undefined>
  constructor(existing: BookMeta, title: string, commit: (choice: DuplicateChoice) => Promise<BookRecord | undefined>) {
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
): Promise<BookRecord> {
  if (!file.size) throw new ImportError(t('import.empty'))
  if (!isEpub(file) && !isPdf(file) && !isTxt(file) && !isDocx(file) && !isNative(file) && !isAudio(file))
    throw new ImportError(t('import.unsupported'))
  try {
    return await readIntoLibrary(file, onProgress, onDuplicate)
  } catch (e) {
    if (e instanceof DeferredDuplicate) throw e
    console.error(e)
    throw new ImportError(explainImportError(e))
  }
}

async function readIntoLibrary(
  file: File,
  onProgress?: (msg: string) => void,
  onDuplicate?: OnDuplicate,
): Promise<BookRecord> {
  // Hash the file as the user supplied it (a PDF/TXT conversion isn't guaranteed to be byte-stable).
  const id = await contentId(file)
  if (await hasBook(id)) throw new ImportError(ALREADY_EXISTS)

  let epub = file
  let fromPdf = false
  let audio: AudioInfo | undefined
  let cover: Blob | undefined
  let title: string
  let author: string
  let book: { destroy?: () => void } = {}

  if (isAudio(file)) {
    onProgress?.(t('import.readingAudio'))
    const m = await readAudioMeta(file)
    audio = m.info
    cover = m.cover
    title = m.title || file.name.replace(/\.[^.]+$/, '')
    author = m.author
  } else {
  // Converters pull in pdf.js / JSZip, so they load only when an import actually needs them.
  const { makeBook } = await import('foliate-js/view.js')

  if (isPdf(file)) {
    // Convert the PDF into a real EPUB first, then read it exactly like any other EPUB.
    const [{ extractPdf }, { buildEpub }] = await Promise.all([import('./pdfToBook'), import('./pdfToEpub')])
    const x = await extractPdf(
      file,
      file.name,
      (done, total) => onProgress?.(`${t('import.extracting')} ${done}/${total}`),
      (done, total) => onProgress?.(`${t('import.ocr')} ${Math.min(done + 1, total)}/${total}`),
    )
    fromPdf = true
    if (x.hasTables) {
      // a text conversion would wreck the tables: keep the PDF itself, which foliate-js shows page by page
      cover = x.cover
      onProgress?.(t('import.pdfTables'))
    } else {
      onProgress?.(t('import.pdfConverting'))
      const blob = await buildEpub(x)
      epub = new File([blob], file.name.replace(/\.pdf$/i, '') + '.epub', { type: 'application/epub+zip' })
    }
  }

  if (isTxt(file)) {
    onProgress?.(t('import.converting'))
    const [{ extractTxt }, { buildEpub }] = await Promise.all([import('./txtToBook'), import('./pdfToEpub')])
    const blob = await buildEpub(await extractTxt(file))
    epub = new File([blob], file.name.replace(/\.txt$/i, '') + '.epub', { type: 'application/epub+zip' })
  }

  if (isDocx(file)) {
    onProgress?.(t('import.converting'))
    const [{ extractDocx }, { buildEpub }] = await Promise.all([import('./docxToBook'), import('./pdfToEpub')])
    const blob = await buildEpub(await extractDocx(file))
    epub = new File([blob], file.name.replace(/\.docx$/i, '') + '.epub', { type: 'application/epub+zip' })
  }

  onProgress?.(t('import.reading'))
  if (isNative(file)) epub = lowerName(file)
  const opened = await makeBook(epub)
  book = opened
  try {
    cover = (await opened.getCover?.()) ?? cover
  } catch {
    /* no cover */
  }
  title = langMap(opened.metadata?.title) || epub.name.replace(/\.[^.]+$/, '')
  author = contributor(opened.metadata?.author)
  }

  const dup = (await listBooks()).find((b) => sameBook(b, { title, author }))
  let replaceId: string | undefined
  if (dup) {
    const choice = onDuplicate ? await onDuplicate(dup) : 'skip'
    if (choice === 'defer') {
      throw new DeferredDuplicate(dup, title, async (c) => {
        if (c === 'skip') {
          book.destroy?.()
          return undefined
        }
        return store(c === 'replace' ? dup.id : undefined)
      })
    }
    if (choice === 'skip') {
      book.destroy?.()
      throw new ImportError(ALREADY_EXISTS)
    }
    if (choice === 'replace') replaceId = dup.id
  }

  return store(replaceId)

  async function store(replaceId: string | undefined): Promise<BookRecord> {
  const rec: BookRecord = {
    id,
    file: epub,
    fileName: epub.name,
    addedAt: Date.now(),
    kind: audio ? 'audio' : 'epub',
    fromPdf,
    audio,
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
