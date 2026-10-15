import { makeBook } from 'foliate-js/view.js'
import { extractPdf } from './pdfToBook'
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
  const base = {
    id: newId(),
    file,
    fileName: file.name,
    addedAt: Date.now(),
  }

  if (isPdf(file)) {
    const x = await extractPdf(file, file.name, (d, t) => onProgress?.(`מחלץ טקסט מה-PDF… ${d}/${t}`))
    const rec: BookRecord = {
      ...base,
      kind: 'pdf',
      title: x.title,
      author: x.author,
      pdf: { rtl: x.rtl, pageCount: x.pageCount, sections: x.sections },
    }
    await saveBook(rec)
    return rec
  }

  onProgress?.('קורא את הספר…')
  const book = await makeBook(file)
  let cover: Blob | undefined
  try {
    cover = (await book.getCover?.()) ?? undefined
  } catch {
    /* no cover */
  }
  const rec: BookRecord = {
    ...base,
    kind: 'epub',
    title: langMap(book.metadata?.title) || file.name.replace(/\.[^.]+$/, ''),
    author: contributor(book.metadata?.author),
    cover,
  }
  book.destroy?.()
  await saveBook(rec)
  return rec
}
