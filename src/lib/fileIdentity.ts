// What a file on the phone is as a book: its title and author, read the way the app reads them when it adds a book (the
// EPUB's or MOBI's own metadata through the reader's engine, a PDF's document info), so that two files are compared by
// lib/sameBook exactly as a book being added is compared with the library. A file the library follows is that book, as
// the library names it. What was read is remembered per file (path, size, time), so a file is opened once, not at every scan.
import { createStore, get, set } from 'idb-keyval'
import type { BookMeta } from './db'
import { readDeviceFile, type DeviceFile } from './deviceBooks'
import type { Identity } from './phoneDuplicates'
import { realAuthor } from './authorName'
import { contributor, langMap } from './importBook'
import { repairEpub } from './epubRepair'
import { crashedBefore, guarded, pathKey } from './crashGuard'

const store = createStore('reader-file-identity-db', 'ids')
const keyOf = (f: DeviceFile) => `${f.path}|${f.size}|${f.modified}`

/** a file bigger than this is not opened for its name: reading it whole would cost too much memory */
const MAX_BYTES = 60 * 1024 * 1024

const nativeBook = (f: File) => /\.(mobi|azw3?|fb2|fbz|fb2\.zip|cbz)$/i.test(f.name)
const isCbr = (f: File) => /\.cbr$/i.test(f.name)

/** the title and author inside a file; undefined when it cannot be read */
async function readIdentity(file: File): Promise<Identity | undefined> {
  try {
    if (/\.pdf$/i.test(file.name)) {
      const [pdfjs, { default: workerUrl }] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
      ])
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      const task = pdfjs.getDocument({ data: await file.arrayBuffer(), wasmUrl: new URL('pdfjs-wasm/', document.baseURI).href })
      try {
        const pdf = await task.promise
        const info = ((await pdf.getMetadata().catch(() => null))?.info ?? {}) as Record<string, string>
        return { title: (info.Title ?? '').trim(), author: realAuthor(info.Author) }
      } finally {
        void task.destroy().catch(() => {})
      }
    }
    const { makeBook } = await import('foliate-js/view.js')
    // a comic RAR is read as the CBZ it is converted to (what the library does when it adds it)
    if (isCbr(file)) file = await (await import('./cbrToCbz')).cbrToCbz(file)
    const lower = nativeBook(file) && file.name !== file.name.toLowerCase() ? new File([file], file.name.toLowerCase(), { type: file.type }) : file
    const opened = await makeBook(/\.epub$/i.test(file.name) ? await repairEpub(file) : lower)
    try {
      return { title: langMap(opened.metadata?.title).trim(), author: realAuthor(contributor(opened.metadata?.author)) }
    } finally {
      opened.destroy?.()
    }
  } catch {
    return undefined
  }
}

/**
 * The identity of each file: for one the library follows, the library's own title and author; for the others what is read
 * from the file (remembered), one at a time. A file that cannot be read, or is too big, simply has none: it is then compared by
 * its name alone. `onProgress` reports how many files were looked at; a cancel (`signal`) stops at once and keeps what was read.
 */
export async function identifyFiles(
  files: DeviceFile[],
  library: Pick<BookMeta, 'id' | 'title' | 'author'>[],
  links: Map<string, string>,
  opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<Map<string, Identity>> {
  const out = new Map<string, Identity>()
  const byId = new Map(library.map((b) => [b.id, b]))
  let done = 0
  for (const f of files) {
    opts.signal?.throwIfAborted()
    opts.onProgress?.(done++, files.length)
    const book = byId.get(links.get(f.path) ?? '')
    if (book) {
      out.set(f.path, { title: book.title, author: book.author })
      continue
    }
    const kept = await get<Identity>(keyOf(f), store).catch(() => undefined)
    if (kept) {
      out.set(f.path, kept)
      continue
    }
    // too big, or it closed the app the last time it was opened: compared by its name alone
    if (f.size > MAX_BYTES || crashedBefore(pathKey(f.path))) continue
    const read = await guarded(pathKey(f.path), f.name, 'fileIdentity', async () => {
      const file = await readDeviceFile(f).catch(() => undefined)
      return file && (await readIdentity(file))
    })
    if (!read) continue
    out.set(f.path, read)
    await set(keyOf(f), read, store).catch(() => {})
  }
  opts.onProgress?.(files.length, files.length)
  return out
}
