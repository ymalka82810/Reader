// Sharing books from the library through the phone's share sheet (WhatsApp, Gmail, Drive, Bluetooth…): one book, the
// books picked in selection mode, or whole folders, each in the format the user picked (converted on the device first,
// like "download to phone"). In the Android app the files go through the native DeviceBooks plugin (the WebView has no
// Web Share); in a browser through navigator.share, or as plain downloads where files can't be shared.

import type { PdfOptions } from './pdfOptions'
import { getBook, type BookRecord } from './db'
import { deviceBooksSupported, hasDeviceAccess } from './deviceBooks'
import { download } from './download'
import { exportBook, ExportError, formatExtension, isOwnFormat, type BookFormat, type ExportStage } from './bookExport'
import { bookFileName, phoneFileOf } from './phoneFiles'

interface CapacitorBridge {
  nativePromise: <T>(plugin: string, method: string, options?: object) => Promise<T>
}
const call = <T>(method: string, options?: object) =>
  (globalThis as unknown as { Capacitor: CapacitorBridge }).Capacitor.nativePromise<T>('DeviceBooks', method, options)

const CHUNK = 768 * 1024 // a multiple of 3, so every piece is a whole base64 text of its own

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })

export type ShareProgress =
  | { stage: 'book'; done: number; total: number; title: string }
  | { stage: ExportStage; done: number; total: number; title: string }

export interface ShareResult {
  /** 'shared': the share sheet opened; 'downloaded': files can't be shared here, so they were downloaded instead */
  how: 'shared' | 'downloaded' | 'cancelled'
  /** how many books went out */
  sent: number
  /** books that could not be converted and went out in their own format */
  kept: number
}

type Item = { file?: Blob; path?: string; name: string; id: string; own: boolean }

/** the file that goes out for one book: its stored file, or a converted copy; a book that fails to convert in a share
 *  of several goes out as it is (`kept`), alone it fails as the download does */
async function prepare(
  rec: BookRecord,
  format: BookFormat | undefined,
  many: boolean,
  onStage: (stage: ExportStage, done: number, total: number) => void,
  signal: AbortSignal | undefined,
  pdf: PdfOptions | undefined,
): Promise<Item & { kept: boolean }> {
  const id = rec.id
  const own = isOwnFormat(rec, format)
  if (own) return { file: rec.file, name: bookFileName(rec), id, own: true, kept: false }
  try {
    const file = await exportBook(rec, format!, onStage, signal, pdf)
    return { file, name: bookFileName(rec, formatExtension(rec, format!)), id, own: false, kept: false }
  } catch (e) {
    signal?.throwIfAborted()
    if (!many || !(e instanceof ExportError)) throw e
    return { file: rec.file, name: bookFileName(rec), id, own: true, kept: true }
  }
}

/** writes the files of a share into the app's cache, piece by piece; the first one clears the previous share's */
async function stage(items: Item[], signal?: AbortSignal): Promise<string[]> {
  const paths: string[] = []
  let first = true
  for (const it of items) {
    const file = it.file!
    let saved = await call<{ path: string }>('shareStage', { name: it.name, reset: first, data: await toBase64(file.slice(0, CHUNK)) })
    first = false
    for (let at = CHUNK; at < file.size; at += CHUNK) {
      signal?.throwIfAborted()
      saved = await call<{ path: string }>('shareStage', { path: saved.path, data: await toBase64(file.slice(at, at + CHUNK)) })
    }
    paths.push(saved.path)
  }
  return paths
}

/** Shares these books in `format` (each converted first; one that can't take the format goes out as it is). */
export async function shareBooks(
  ids: string[],
  format: BookFormat | undefined,
  title: string,
  onProgress?: (p: ShareProgress) => void,
  signal?: AbortSignal,
  pdf?: PdfOptions,
): Promise<ShareResult> {
  const items: Item[] = []
  let kept = 0
  const native = deviceBooksSupported()
  // a book's own file already on the phone is shared from where it is, with no copy through the bridge
  const access = native && (await hasDeviceAccess())
  for (const [i, id] of ids.entries()) {
    signal?.throwIfAborted()
    const rec = await getBook(id)
    if (!rec) continue
    onProgress?.({ stage: 'book', done: i + 1, total: ids.length, title: rec.title })
    const item = await prepare(rec, format, ids.length > 1, (stage, done, total) => onProgress?.({ stage, done, total, title: rec.title }), signal, pdf)
    if (item.kept) kept++
    if (access && item.own) {
      const path = await phoneFileOf(id)
      if (path) item.path = path
    }
    items.push(item)
  }
  signal?.throwIfAborted()
  if (!items.length) return { how: 'cancelled', sent: 0, kept }

  if (native) {
    try {
      await call('share', { paths: items.map((it) => it.path ?? ''), title })
      return { how: 'shared', sent: items.length, kept }
    } catch (e) {
      if (!(e instanceof Error && e.message === 'missing')) throw new Error('share')
    }
    // a file on the phone was moved or deleted since: everything goes through the app's cache instead
    try {
      const paths = await stage(items, signal)
      signal?.throwIfAborted()
      await call('share', { paths, title })
    } catch {
      signal?.throwIfAborted()
      throw new Error('share')
    }
    return { how: 'shared', sent: items.length, kept }
  }

  const files = items.map((it) => new File([it.file!], it.name, { type: it.file!.type || 'application/octet-stream' }))
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title })
      return { how: 'shared', sent: items.length, kept }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return { how: 'cancelled', sent: 0, kept }
      // too big or refused by the browser: downloaded below
    }
  }
  for (const f of files) download(f, f.name)
  return { how: 'downloaded', sent: items.length, kept }
}
