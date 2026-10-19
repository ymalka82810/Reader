// A book's own file on the phone (Android app only): its name follows the book's title and author, and a single
// book can be saved there from the library. Talks to the native DeviceBooks plugin like lib/deviceBooks.ts does.

import { createStore, del, get, set } from 'idb-keyval'
import { getBook, getBookMeta, type BookMeta } from './db'
import { deviceBooksSupported, hasDeviceAccess, markSeen, requestDeviceAccess } from './deviceBooks'
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

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** "Title - Author.epub": the extension of the stored file (a converted PDF is an EPUB) */
export function bookFileName(b: Pick<BookMeta, 'title' | 'author' | 'fileName' | 'fromPdf' | 'kind'>): string {
  const dot = b.fileName.lastIndexOf('.')
  const ext = b.fromPdf || b.kind === 'epub' ? 'epub' : dot > 0 ? b.fileName.slice(dot + 1).toLowerCase() : ''
  const stem = safeFileName([b.title, b.author].map((s) => s.trim()).filter(Boolean).join(' - '), 'book')
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

/** Renames the phone's file of each book to match its current title and author. Books never put on the phone, or
 *  whose file is no longer there, are left alone. Resolves with how many were renamed and how many failed. */
export async function syncPhoneNames(ids: string[]): Promise<{ renamed: number; failed: number }> {
  const out = { renamed: 0, failed: 0 }
  if (!deviceBooksSupported()) return out
  for (const id of ids) {
    const [path, meta] = await Promise.all([phoneFileOf(id), getBookMeta(id)])
    if (!path || !meta) continue
    const name = bookFileName(meta)
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

/** the books' phone files follow their names by themselves (the setting), once access is there */
export const autoSyncPhoneNames = (ids: string[]) =>
  loadSettings().phoneRenameSync ? syncPhoneNames(ids) : Promise.resolve({ renamed: 0, failed: 0 })
