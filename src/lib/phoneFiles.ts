// A book's own file on the phone (Android app only): its name follows the book's title, and a single
// book can be saved there from the library. Talks to the native DeviceBooks plugin like lib/deviceBooks.ts does.

import { createStore, del, get, keys, set, values } from 'idb-keyval'
import { getBook, getBookMeta, getFile, listBooks, type BookMeta } from './db'
import { deviceBooksSupported, hasDeviceAccess, markSeen, requestDeviceAccess, type DeviceFile } from './deviceBooks'
import { download } from './download'
import { loadSettings } from './settings'
import { safeFileName } from './notesExport'

interface CapacitorBridge {
  nativePromise: <T>(plugin: string, method: string, options?: object) => Promise<T>
}
const call = <T>(method: string, options?: object) =>
  (globalThis as unknown as { Capacitor: CapacitorBridge }).Capacitor.nativePromise<T>('DeviceBooks', method, options)

// book id -> where its file is on the phone; its own database, as the "seen" one holds a single store
const pathStore = createStore('reader-device-paths-db', 'paths')

export const rememberPhoneFile = (id: string, path: string) => set(id, path, pathStore)
export const phoneFileOf = (id: string) => get<string>(id, pathStore)
export const forgetPhoneFile = (id: string) => del(id, pathStore)
/** the paths of every file tied to a book, also of books since deleted from the library */
export const phoneFilePaths = async () => new Set(await values<string>(pathStore))

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** The book's title, which follows the naming template ("פרסי ג'קסון 1 - גנב הברק.epub"), with the extension of the stored
 *  file (a converted PDF is an EPUB). The author is the folder's business, not the file's. */
export function bookFileName(b: Pick<BookMeta, 'title' | 'fileName' | 'fromPdf' | 'kind'>, extension?: string): string {
  const dot = b.fileName.lastIndexOf('.')
  const ext = extension ?? (b.fromPdf || b.kind === 'epub' ? 'epub' : dot > 0 ? b.fileName.slice(dot + 1).toLowerCase() : '')
  const stem = safeFileName(b.title.trim(), 'book')
  return ext ? `${stem}.${ext}` : stem
}

const CHUNK = 768 * 1024 // a multiple of 3, so every piece is a whole base64 text of its own

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })

/** Saves one book from the library to the phone's Download folder (a normal download in the browser).
 *  Resolves with the name it was saved under; undefined when the book is gone. */
export async function saveBookToPhone(id: string): Promise<string | undefined> {
  const rec = await getBook(id)
  if (!rec) return undefined
  const name = bookFileName(rec)
  if (!deviceBooksSupported()) {
    download(rec.file, name)
    return name
  }
  if (!(await hasDeviceAccess()) && !(await requestDeviceAccess())) throw new Error('permission')
  type Saved = { path: string; name: string; size: number; modified: number }
  let saved = await call<Saved>('save', { name, data: await toBase64(rec.file.slice(0, CHUNK)) })
  for (let at = CHUNK; at < rec.file.size; at += CHUNK) {
    saved = await call<Saved>('save', { path: saved.path, data: await toBase64(rec.file.slice(at, at + CHUNK)) })
  }
  await rememberPhoneFile(id, saved.path)
  // it sits in a scanned folder: the next scan must not offer the book's own copy as a new find
  await markSeen([{ path: saved.path, name: saved.name, size: saved.size, modified: saved.modified }]).catch(() => {})
  return saved.name
}

/** Renames the phone's file of each book to match its current title. Books never put on the phone, or
 *  whose file is no longer there, are left alone. Resolves with how many were renamed and how many failed. */
export async function syncPhoneNames(ids: string[]): Promise<{ renamed: number; failed: number }> {
  const out = { renamed: 0, failed: 0 }
  if (!deviceBooksSupported()) return out
  for (const id of ids) {
    const [path, meta] = await Promise.all([phoneFileOf(id), getBookMeta(id)])
    if (!path || !meta) continue
    // the phone's file keeps its own extension: a book converted from a PDF is an EPUB here, but its file there is still the PDF
    const dot = path.lastIndexOf('.')
    const name = bookFileName(meta, dot > path.lastIndexOf('/') + 1 ? path.slice(dot + 1).toLowerCase() : '')
    if (baseName(path) === name) continue
    try {
      const res = await call<{ path: string }>('rename', { path, name })
      await rememberPhoneFile(id, res.path)
      out.renamed++
    } catch (e) {
      // the file was moved or deleted on the phone: stop following it
      if (e instanceof Error && e.message === 'missing') await forgetPhoneFile(id).catch(() => {})
      out.failed++
    }
  }
  return out
}

/** Brings every book's file on the phone up to date once: the name follows the book's title and author, and the system's
 *  media index (what file managers and other readers show) learns the current names, also for books renamed before the
 *  index was updated. Resolves with how many files were renamed. */
export async function refreshPhoneFiles(): Promise<number> {
  if (!deviceBooksSupported()) return 0
  const ids = (await keys(pathStore)).map(String)
  const { renamed } = await syncPhoneNames(ids)
  const paths = (await Promise.all(ids.map((id) => phoneFileOf(id)))).filter((p): p is string => !!p)
  await call('refreshIndex', { paths }).catch(() => {})
  return renamed
}

/** the same, once after the update that fixed the index, then on demand */
const REFRESHED_KEY = 'reader:phoneIndexRefreshed'
export async function refreshPhoneFilesOnce(): Promise<void> {
  try {
    if (localStorage.getItem(REFRESHED_KEY)) return
    await refreshPhoneFiles()
    localStorage.setItem(REFRESHED_KEY, '1')
  } catch {
    // tried again at the next scan
  }
}

/** the books' phone files follow their names by themselves (the setting), once access is there */
export const autoSyncPhoneNames = (ids: string[]) =>
  loadSettings().phoneRenameSync ? syncPhoneNames(ids) : Promise.resolve({ renamed: 0, failed: 0 })

/** a book not yet tied to a file on the phone; `size` is read only when a name matches, as it opens the book's file */
type LinkCandidate = { id: string; fileName: string; fromPdf?: boolean; size: () => Promise<number | undefined> }

const lower = (s: string) => s.toLowerCase()

/** Which phone file belongs to which book, by the name the book was added under and its size. A book converted from a
 *  PDF changed in size, so it is matched by name alone, and only when that name points at one PDF. Whatever is
 *  ambiguous stays unlinked. Resolves with book id -> path. */
export async function matchPhoneFiles(books: LinkCandidate[], files: DeviceFile[]): Promise<Map<string, string>> {
  const byName = new Map<string, DeviceFile[]>()
  const pdfByStem = new Map<string, DeviceFile[]>()
  for (const f of files) {
    const n = lower(f.name)
    byName.set(n, [...(byName.get(n) ?? []), f])
    if (n.endsWith('.pdf')) pdfByStem.set(n.slice(0, -4), [...(pdfByStem.get(n.slice(0, -4)) ?? []), f])
  }
  const out = new Map<string, string>()
  const taken = new Set<string>()
  for (const b of books) {
    const name = lower(b.fileName)
    const same = (byName.get(name) ?? []).filter((f) => !taken.has(f.path))
    let found: DeviceFile | undefined
    if (same.length) {
      const size = await b.size()
      const fits = size === undefined ? same : same.filter((f) => f.size === size)
      if (fits.length === 1) found = fits[0]
    } else if (b.fromPdf && name.endsWith('.epub')) {
      const pdfs = (pdfByStem.get(name.slice(0, -5)) ?? []).filter((f) => !taken.has(f.path))
      if (pdfs.length === 1) found = pdfs[0]
    }
    if (!found) continue
    taken.add(found.path)
    out.set(b.id, found.path)
  }
  return out
}

/** Ties the library's books that have no phone file yet to the ones a scan just found, so they follow the book's name too.
 *  Resolves with how many were linked. */
export async function linkKnownBooks(files: DeviceFile[]): Promise<number> {
  if (!files.length) return 0
  const linked = new Set((await keys(pathStore)).map(String))
  const open = (await listBooks()).filter((b) => !linked.has(b.id))
  const found = await matchPhoneFiles(
    open.map((b) => ({ id: b.id, fileName: b.fileName, fromPdf: b.fromPdf, size: async () => (await getFile(b.id))?.size })),
    files,
  )
  for (const [id, path] of found) await rememberPhoneFile(id, path)
  return found.size
}
