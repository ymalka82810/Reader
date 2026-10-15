import { makeBook } from 'foliate-js/view.js'
import { extractPdf } from './pdfToBook'
import { buildEpub } from './pdfToEpub'
import { newId, saveBook, type BookRecord } from './db'

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

const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'

export async function importFile(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<BookRecord> {
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

  onProgress?.('קורא את הספר…')
  const book = await makeBook(epub)
  let cover: Blob | undefined
  try {
    cover = (await book.getCover?.()) ?? undefined
  } catch {
    /* no cover */
  }
  const rec: BookRecord = {
    id: newId(),
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
