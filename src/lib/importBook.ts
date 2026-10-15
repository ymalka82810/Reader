import { makeBook } from 'foliate-js/view.js'
import { extractPdf } from './pdfToBook'
import { buildEpub } from './pdfToEpub'
import { extractTxt } from './txtToBook'
import { contentId, getBook, saveBook, type BookRecord } from './db'

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

export async function importFile(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<BookRecord> {
  // Hash the file as the user supplied it (a PDF/TXT conversion isn't guaranteed to be byte-stable).
  const id = await contentId(file)
  const existing = await getBook(id)
  if (existing) return existing

  let epub = file
  let fromPdf = false

  if (isPdf(file)) {
    // Convert the PDF into a real EPUB first, then read it exactly like any other EPUB.
    const x = await extractPdf(file, file.name, (d, t) => onProgress?.(`מחלץ טקסט מה-PDF… ${d}/${t}`))
    onProgress?.('ממיר ל-EPUB…')
    const blob = await buildEpub(x)
    epub = new File([blob], file.name.replace(/\.pdf$/i, '') + '.epub', { type: 'application/epub+zip' })
    fromPdf = true
  }

  if (isTxt(file)) {
    onProgress?.('ממיר ל-EPUB…')
    const blob = await buildEpub(await extractTxt(file))
    epub = new File([blob], file.name.replace(/\.txt$/i, '') + '.epub', { type: 'application/epub+zip' })
  }

  onProgress?.('קורא את הספר…')
  const book = await makeBook(epub)
  let cover: Blob | undefined
  try {
    cover = (await book.getCover?.()) ?? undefined
  } catch {
    /* no cover */
  }
  const rec: BookRecord = {
    id,
    file: epub,
    fileName: epub.name,
    addedAt: Date.now(),
    kind: 'epub',
    fromPdf,
    title: langMap(book.metadata?.title) || epub.name.replace(/\.[^.]+$/, ''),
    author: contributor(book.metadata?.author),
    cover,
  }
  book.destroy?.()
  await saveBook(rec)
  return rec
}
