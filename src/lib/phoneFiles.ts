// A book's own file on the phone (Android app only): its name follows the book's title, and a single
// book can be saved there from the library. Talks to the native DeviceBooks plugin like lib/deviceBooks.ts does.

import { createStore, del, entries, get, keys, set } from 'idb-keyval'
import type { PdfOptions } from './pdfOptions'
import { getBook, getBookMeta, getFile, listBooks, type BookMeta } from './db'
import { deviceBooksSupported, hasDeviceAccess, markSeen, requestDeviceAccess, scanDevice, type DeviceFile } from './deviceBooks'
import { download } from './download'
import { exportBook, formatExtension, isOwnFormat, type BookFormat, type ExportStage } from './bookExport'
import { loadSettings } from './settings'
import { safeFileName } from './notesExport'
import { folderKey, folderKeyOfName, folderName, groupFolders } from './folders'
import { LIBRARY_DIR_NAME, VERSIONS_DIR_NAME, authorDirOf, sameBookOnPhone, type DuplicateGroup } from './phoneDuplicates'
import { t } from '../i18n'
import { shownName } from './bookName'

interface CapacitorBridge {
  nativePromise: <T>(plugin: string, method: string, options?: object) => Promise<T>
}
const call = <T>(method: string, options?: object) =>
  (globalThis as unknown as { Capacitor: CapacitorBridge }).Capacitor.nativePromise<T>('DeviceBooks', method, options)

// book id -> where its file is on the phone; its own database, as the "seen" one holds a single store
const pathStore = createStore('reader-device-paths-db', 'paths')

// a converted copy saved to Download (path -> the book it came from): the next scan moves it to the author's versions folder
const versionStore = createStore('reader-device-versions-db', 'versions')

// the versions already filed under an author's versions folder (path -> the book they belong to), so that they follow the
// book when it moves to another author's folder
const versionFilesStore = createStore('reader-device-version-files-db', 'files')

/** the sub-folder of a book's folder that holds its other formats, one folder per format */
const VERSIONS_DIR = VERSIONS_DIR_NAME

// book id -> the copies the user saved to Download from the library (a book's own file is the one above): they follow the
// book's name too, so a copy uploaded to Drive or shared from Download never carries a name the book no longer has
const copyStore = createStore('reader-device-copies-db', 'copies')
const copiesOf = async (id: string) => (await get<string[]>(id, copyStore)) ?? []
const rememberCopy = async (id: string, path: string) =>
  set(id, [...new Set([...(await copiesOf(id)), path])].slice(-5), copyStore)

export const rememberPhoneFile = (id: string, path: string) => set(id, path, pathStore)
export const phoneFileOf = (id: string) => get<string>(id, pathStore)
export const forgetPhoneFile = (id: string) => del(id, pathStore)
/** which book each file on the phone is tied to (by path) */
export const phoneFileLinks = async () => new Map(await entries<string, string>(pathStore))
/** the paths of the files tied to books that are in the library now: a book deleted from it no longer holds its file,
 *  so a retry offers that file again */
export async function phoneFilePathsInLibrary(): Promise<Set<string>> {
  const ids = new Set((await listBooks()).map((b) => b.id))
  const paths = new Set<string>()
  for (const [id, path] of await entries<string, string>(pathStore)) if (ids.has(String(id))) paths.add(path)
  for (const [id, copies] of await entries<string, string[]>(copyStore)) if (ids.has(String(id))) copies.forEach((c) => paths.add(c))
  return paths
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** The book's title, which follows the naming template ("פרסי ג'קסון 1 - גנב הברק.epub"), with the extension of the stored
 *  file: its own name tells it (a PDF converted on import is kept as "….epub", a PDF too big or a scan kept as "….pdf",
 *  a MOBI as "….mobi"). The author is the folder's business, not the file's. */
export function bookFileName(b: Pick<BookMeta, 'title' | 'fileName' | 'fromPdf' | 'kind'>, extension?: string): string {
  const dot = b.fileName.lastIndexOf('.')
  const own = dot > 0 ? b.fileName.slice(dot + 1).toLowerCase() : ''
  const ext = extension ?? (own || (b.fromPdf || b.kind === 'epub' ? 'epub' : ''))
  const stem = safeFileName(shownName(b.title.trim()), 'book')
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

/** Writes any file (a library backup) to the phone's Download folder through the native plugin, in pieces.
 *  Resolves with the name it was saved under. Android app only. */
export async function saveBlobToPhone(blob: Blob, name: string): Promise<string> {
  if (!(await hasDeviceAccess()) && !(await requestDeviceAccess().catch(() => false))) throw new Error('permission')
  type Saved = { path: string; name: string }
  try {
    let saved = await call<Saved>('save', { name, data: await toBase64(blob.slice(0, CHUNK)) })
    for (let at = CHUNK; at < blob.size; at += CHUNK) {
      saved = await call<Saved>('save', { path: saved.path, data: await toBase64(blob.slice(at, at + CHUNK)) })
    }
    await call('scanFile', { path: saved.path }).catch(() => {})
    return saved.name
  } catch (e) {
    throw new Error(e instanceof Error && e.message === 'permission' ? 'permission' : 'save')
  }
}

/** Writes a book's blob to the phone in pieces (into the books folder's sub-folder `dir`, or Download without one), and,
 *  unless `link` is false, ties the book to the new file. Resolves with what the native side saved. */
async function writeToPhone(id: string, file: Blob, name: string, dir?: string, link = true) {
  type Saved = { path: string; name: string; size: number; modified: number }
  let saved: Saved
  try {
    saved = await call<Saved>('save', { name, dir, data: await toBase64(file.slice(0, CHUNK)) })
    for (let at = CHUNK; at < file.size; at += CHUNK) {
      saved = await call<Saved>('save', { path: saved.path, data: await toBase64(file.slice(at, at + CHUNK)) })
    }
  } catch (e) {
    // the native side only says "permission" or "save"; anything else is a bridge/read failure
    throw new Error(e instanceof Error && e.message === 'permission' ? 'permission' : 'save')
  }
  if (link) await rememberPhoneFile(id, saved.path)
  // it sits in a scanned folder: the next scan must not offer the book's own copy as a new find
  await markSeen([{ path: saved.path, name: saved.name, size: saved.size, modified: saved.modified }]).catch(() => {})
  return saved
}

/** Saves one book from the library to the phone, always into the Download folder (a normal download in the browser): it
 *  is the user's own copy, apart from the book's file in the books folder. `format` converts it first (lib/bookExport);
 *  without one, or in the format it is kept in, the stored file itself is saved. A book with no file on the phone yet,
 *  while the books folder is off, is tied to a download of its own file so it follows the book's name (a converted copy
 *  never is). Resolves with the name it was saved under; undefined when the book is gone. */
export async function saveBookToPhone(
  id: string,
  format?: BookFormat,
  onProgress?: (stage: ExportStage, done: number, total: number) => void,
  signal?: AbortSignal,
  pdf?: PdfOptions,
): Promise<string | undefined> {
  const rec = await getBook(id)
  if (!rec) return undefined
  const own = isOwnFormat(rec, format)
  // asked first, so a refused permission does not wait for a long conversion
  if (deviceBooksSupported() && !(await hasDeviceAccess()) && !(await requestDeviceAccess().catch(() => false))) throw new Error('permission')
  const file = own ? rec.file : await exportBook(rec, format!, onProgress, signal, pdf)
  signal?.throwIfAborted()
  const name = own ? bookFileName(rec) : bookFileName(rec, formatExtension(rec, format!))
  if (!deviceBooksSupported()) {
    download(file, name)
    return name
  }
  const link = own && !libraryFolderOn() && !(await phoneFileOf(id))
  const saved = await writeToPhone(id, file, name, undefined, link)
  // the system's Downloads list only knows a file once it is indexed; without this it shows up only after that app is opened
  await call('scanFile', { path: saved.path }).catch(() => {})
  // a converted copy is marked, so that the next scan files it under the author's versions folder
  if (!own) await set(saved.path, id, versionStore).catch(() => {})
  // a copy in the book's own format that is not tied as its file is still followed, so a later rename of the book renames it too
  else if (!link) await rememberCopy(id, saved.path).catch(() => {})
  return saved.name
}

/** Opens the phone's Downloads folder (where saved books land) in the system's Downloads app. */
export const openDownloadsFolder = () => call('openDownloads').then(() => undefined)

/** The sub-folder of the books folder a book belongs in: its library folder (the author, unless the user picked another). */
export const bookPhoneDir = (b: Pick<BookMeta, 'author' | 'folder'>, names?: Map<string, string>): string =>
  safeFileName(names?.get(folderKey(b)) ?? folderName(b), '') || t('folder.noAuthor')

/** The one name each library folder gets on the phone: books whose folder differs only by nikud, case or spacing share
 *  a folder in the library, so they must share one on the phone too (the plainest spelling, as the library shows it). */
async function phoneDirNames(): Promise<Map<string, string>> {
  return new Map(groupFolders(await listBooks()).map((f) => [f.key, f.name]))
}

const libraryFolderOn = () => loadSettings().phoneLibraryFolder

/** the filed versions, by the book each belongs to */
async function versionsByBook(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  for (const [path, id] of await entries<string, string>(versionFilesStore)) out.set(id, [...(out.get(id) ?? []), path])
  return out
}

/** A book's filed versions follow it: each goes to its versions folder under the book's folder now (its author's, or the one the
 *  user picked), named after the book's title. One that was moved or deleted on the phone is forgotten. Resolves with how
 *  many were moved and how many could not be. */
async function followVersions(id: string, meta: BookMeta, paths: string[], names: Map<string, string>): Promise<{ moved: number; failed: number }> {
  const out = { moved: 0, failed: 0 }
  for (const path of paths) {
    const dot = path.lastIndexOf('.')
    const ext = dot > path.lastIndexOf('/') + 1 ? path.slice(dot + 1).toLowerCase() : ''
    if (!ext) continue
    try {
      const res = await call<DeviceFile>('place', { path, name: bookFileName(meta, ext), dir: versionPhoneDir(meta, ext, names) })
      if (res.path === path) continue
      await markSeen([res]).catch(() => {})
      await repointPhoneFile(path, res.path)
      await del(path, versionFilesStore)
      await set(res.path, id, versionFilesStore)
      out.moved++
    } catch (e) {
      if (e instanceof Error && e.message === 'missing') {
        await del(path, versionFilesStore).catch(() => {})
        await repointPhoneFile(path).catch(() => {})
      } else out.failed++
    }
  }
  return out
}

/** Gives the phone's file of each book the name of its title, and, with the books folder on, the sub-folder of its library
 *  folder (moving it there). Books never put on the phone, or whose file is no longer there, are left alone.
 *  Resolves with how many were changed and how many failed. */
export const syncPhoneNames = (ids: string[]): Promise<{ renamed: number; failed: number }> => serially(() => syncPhoneNamesNow(ids))

/** Name syncs run one after the other: an import, an identification and a folder move can each ask for the same book at the
 *  same moment, and two of them reading the book's old path would both try to move the file, the second one finding it
 *  gone and dropping the link to the file the first one had just put in the book's folder (after which it was never renamed). */
let syncQueue: Promise<unknown> = Promise.resolve()
function serially<T>(job: () => Promise<T>): Promise<T> {
  const run = syncQueue.then(job, job)
  syncQueue = run.catch(() => {})
  return run
}

async function syncPhoneNamesNow(ids: string[]): Promise<{ renamed: number; failed: number }> {
  const out = { renamed: 0, failed: 0 }
  if (!deviceBooksSupported()) return out
  const organise = libraryFolderOn()
  const names = organise ? await phoneDirNames() : undefined
  const versions = organise ? await versionsByBook() : new Map<string, string[]>()
  for (const id of ids) {
    const [path, meta] = await Promise.all([phoneFileOf(id), getBookMeta(id)])
    if (meta && organise) {
      const r = await followVersions(id, meta, versions.get(id) ?? [], names!)
      out.renamed += r.moved
      out.failed += r.failed
    }
    if (meta) await syncCopies(id, meta, path, out)
    if (!path || !meta) continue
    // the phone's file keeps its own extension: a book converted from a PDF is an EPUB here, but its file there is still the PDF
    const dot = path.lastIndexOf('.')
    const name = bookFileName(meta, dot > path.lastIndexOf('/') + 1 ? path.slice(dot + 1).toLowerCase() : '')
    const dir = bookPhoneDir(meta, names)
    if (!organise && baseName(path) === name) continue
    try {
      const res = organise
        ? await call<DeviceFile>('place', { path, name, dir })
        : await call<{ path: string }>('rename', { path, name })
      if (res.path === path) continue
      await rememberPhoneFile(id, res.path)
      if (organise) await markSeen([res as DeviceFile]).catch(() => {})
      out.renamed++
    } catch (e) {
      // the file was moved or deleted on the phone: stop following it; but not when the book already follows another file
      // (it was moved meanwhile, and the link now points at its new place)
      if (e instanceof Error && e.message === 'missing' && (await phoneFileOf(id).catch(() => path)) === path) await forgetPhoneFile(id).catch(() => {})
      out.failed++
    }
  }
  return out
}

/** Gives the copies saved to Download the book's current name (they stay where they are, only renamed). A copy that is no
 *  longer there stops being followed. */
async function syncCopies(id: string, meta: BookMeta, main: string | undefined, out: { renamed: number; failed: number }): Promise<void> {
  const paths = await copiesOf(id)
  if (!paths.length) return
  const kept: string[] = []
  for (const path of paths) {
    if (path === main) continue
    const dot = path.lastIndexOf('.')
    const name = bookFileName(meta, dot > path.lastIndexOf('/') + 1 ? path.slice(dot + 1).toLowerCase() : '')
    if (baseName(path) === name) {
      kept.push(path)
      continue
    }
    try {
      const res = await call<Partial<DeviceFile> & { path: string }>('rename', { path, name })
      kept.push(res.path)
      if (res.path !== path) out.renamed++
      // under its new name the scan must not offer it as a new book
      if (res.path !== path && typeof res.size === 'number' && typeof res.modified === 'number')
        await markSeen([res as DeviceFile]).catch(() => {})
    } catch (e) {
      if (e instanceof Error && e.message === 'missing') continue
      kept.push(path)
      out.failed++
    }
  }
  await set(id, kept, copyStore).catch(() => {})
}

/** Puts books in the phone's books folder: a book whose file is already on the phone is moved there, one that has none
 *  (added from the browser, a share or a cloud drive) gets a copy written there. Each lands in the sub-folder of its library
 *  folder. Resolves with how many were put in place and how many failed; `onProgress` reports how far it is. */
export async function placeBooksOnPhone(
  ids: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ placed: number; failed: number }> {
  const out = { placed: 0, failed: 0 }
  if (!deviceBooksSupported() || !ids.length) return out
  if (!(await hasDeviceAccess()) && !(await requestDeviceAccess().catch(() => false))) {
    out.failed = ids.length
    return out
  }
  let done = 0
  const names = await phoneDirNames()
  for (const id of ids) {
    onProgress?.(done++, ids.length)
    try {
      const meta = await getBookMeta(id)
      if (!meta) continue
      const known = await phoneFileOf(id)
      if (known) {
        const { failed } = await syncPhoneNames([id])
        if (!failed) {
          if (meta.fromPdf) await replacePdfWithEpub(id, names)
          out.placed++
          continue
        }
        // the file cannot be moved: that is a failure; but one that is gone from the phone gets the library's copy instead
        if (await phoneFileOf(id)) {
          out.failed++
          continue
        }
      }
      const rec = await getBook(id)
      if (!rec) continue
      await writeToPhone(id, rec.file, bookFileName(rec), bookPhoneDir(rec, names))
      out.placed++
    } catch {
      out.failed++
    }
  }
  onProgress?.(ids.length, ids.length)
  await removeEmptyPhoneFolders()
  return out
}

/** how many converted copies saved to Download wait to be filed under their author's versions folder */
export const pendingVersionCount = async (): Promise<number> => (await keys(versionStore)).length

/** where a converted copy of a book is filed: the book's folder, then the versions folder, then a folder per format */
const versionPhoneDir = (b: Pick<BookMeta, 'author' | 'folder'>, ext: string, names?: Map<string, string>): string =>
  `${bookPhoneDir(b, names)}/${VERSIONS_DIR}/${ext.toUpperCase()}`

/** Files the converted copies saved to Download (marked when they were saved) under their author's versions folder in the
 *  books folder. Only with the books folder on and access given; a copy whose book is gone from the library, or whose
 *  file was moved or deleted on the phone, is forgotten, and one that cannot be moved now stays marked for the next scan.
 *  Resolves with how many were moved. Nothing is ever deleted. */
export async function placeVersions(): Promise<number> {
  if (!deviceBooksSupported() || !libraryFolderOn()) return 0
  const paths = (await keys(versionStore)).map(String)
  if (!paths.length || !(await hasDeviceAccess())) return 0
  const names = await phoneDirNames()
  let moved = 0
  for (const path of paths) {
    const id = await get<string>(path, versionStore)
    const meta = id ? await getBookMeta(id) : undefined
    if (!id || !meta) {
      await del(path, versionStore)
      continue
    }
    const dot = path.lastIndexOf('.')
    const ext = dot > path.lastIndexOf('/') + 1 ? path.slice(dot + 1).toLowerCase() : ''
    if (!ext) {
      await del(path, versionStore)
      continue
    }
    try {
      const res = await call<DeviceFile>('place', { path, name: bookFileName(meta, ext), dir: versionPhoneDir(meta, ext, names) })
      await markSeen([res]).catch(() => {})
      await set(res.path, id, versionFilesStore).catch(() => {})
      await del(path, versionStore)
      moved++
    } catch (e) {
      if (e instanceof Error && e.message === 'missing') await del(path, versionStore)
    }
  }
  return moved
}

/** the library's books that follow a file at `from` now follow the one at `to`, or none when it is gone (`to` undefined) */
async function repointPhoneFile(from: string, to?: string): Promise<void> {
  for (const [id, path] of await entries<string, string>(pathStore)) {
    if (path !== from) continue
    if (to) await rememberPhoneFile(id, to)
    else await forgetPhoneFile(id)
  }
}

/** why a file on the phone could not be moved or deleted, as the native side says it (anything else is "other") */
export type PhoneFailure = 'permission' | 'outside' | 'notbook' | 'remove' | 'place' | 'other'
const failureOf = (e: unknown): PhoneFailure => {
  const m = e instanceof Error ? e.message : ''
  return m === 'permission' || m === 'outside' || m === 'notbook' || m === 'remove' || m === 'place' ? m : 'other'
}

export type TidyResult = {
  deleted: number
  moved: number
  failed: number
  /** files that were no longer where the check found them (moved or deleted meanwhile): nothing to do, not a failure */
  gone: number
  /** versions left where they are: the book's author, and so its folder, is not known */
  unfiled: number
  /** author folders in the books folder that were the same author under another spelling, merged into one */
  merged: number
  /** the failures, by what the phone said */
  reasons: Partial<Record<PhoneFailure, number>>
}

/**
 * Author folders in the books folder that are one folder in the library (the same key: they differ only by invisible
 * marks, nikud, a geresh for an apostrophe, a maqaf for a hyphen…) are merged into the folder of the library's name for
 * that author (or the plainest of them): every file in the others, versions included, moves there under the same
 * sub-path. `files` are what a scan of the books folder found. Resolves with how many folders were merged and, per path
 * that moved, where it is now, so a list made before (the duplicates) can follow it.
 */
export async function mergePhoneAuthorFolders(files: DeviceFile[]): Promise<{ merged: number; moved: Map<string, string>; failed: number; reasons: Partial<Record<PhoneFailure, number>> }> {
  const out = { merged: 0, moved: new Map<string, string>(), failed: 0, reasons: {} as Partial<Record<PhoneFailure, number>> }
  if (!deviceBooksSupported()) return out
  const names = await phoneDirNames()
  const byKey = new Map<string, Set<string>>()
  for (const f of files) {
    const dir = authorDirOf(f.path)
    if (!dir) continue
    const key = folderKeyOfName(dir)
    byKey.set(key, (byKey.get(key) ?? new Set()).add(dir))
  }
  const marker = `/${LIBRARY_DIR_NAME}/`
  for (const [key, dirs] of byKey) {
    const wanted = safeFileName(names.get(key) ?? '', '')
    const target = wanted && (dirs.size > 1 || !dirs.has(wanted)) ? wanted : [...dirs].sort((a, b) => a.normalize('NFD').length - b.normalize('NFD').length || a.localeCompare(b))[0]!
    if (dirs.size === 1 && dirs.has(target)) continue
    let any = false
    for (const f of files) {
      const dir = authorDirOf(f.path)
      if (!dir || dir === target || folderKeyOfName(dir) !== key) continue
      const inner = f.path.slice(f.path.indexOf(marker) + marker.length).split('/').slice(1)
      const sub = inner.slice(0, -1).join('/')
      try {
        const res = await call<DeviceFile>('place', { path: f.path, name: f.name, dir: sub ? `${target}/${sub}` : target })
        await markSeen([res]).catch(() => {})
        await repointPhoneFile(f.path, res.path)
        const owner = await get<string>(f.path, versionFilesStore).catch(() => undefined)
        if (owner) {
          await del(f.path, versionFilesStore).catch(() => {})
          await set(res.path, owner, versionFilesStore).catch(() => {})
        }
        out.moved.set(f.path, res.path)
        any = true
      } catch (e) {
        if (e instanceof Error && e.message === 'missing') continue
        out.failed++
        const r = failureOf(e)
        out.reasons[r] = (out.reasons[r] ?? 0) + 1
      }
    }
    if (any) out.merged++
  }
  return out
}

/** the books folder as a folder to scan (relative to the storage root, as the scan takes it) */
const BOOKS_FOLDER = `Documents/${LIBRARY_DIR_NAME}`

const WHY: Record<PhoneFailure, Parameters<typeof t>[0]> = {
  permission: 'dupes.why.permission',
  outside: 'dupes.why.outside',
  notbook: 'dupes.why.notbook',
  remove: 'dupes.why.remove',
  place: 'dupes.why.place',
  other: 'dupes.why.other',
}

/** what was done, and for what failed why, in one line */
export function tidyMessage(r: TidyResult): string {
  const parts = [t('dupes.done', { deleted: r.deleted, moved: r.moved, failed: r.failed })]
  if (r.merged) parts.push(t('dupes.doneMerged', { n: r.merged }))
  if (r.gone) parts.push(t('dupes.doneGone', { n: r.gone }))
  if (r.unfiled) parts.push(t('dupes.doneUnfiled', { n: r.unfiled }))
  const why = (Object.entries(r.reasons) as [PhoneFailure, number][]).filter(([, n]) => n > 0)
  if (why.length) parts.push(t('dupes.why', { list: why.map(([k, n]) => `${t(WHY[k])} (${n})`).join(', ') }))
  return parts.join(' · ')
}

/** Tidies the books found on the phone more than once (lib/phoneDuplicates): each book's other formats are filed under the
 *  author's versions folder, and the surplus copies the user approved (`approved`, by path) are deleted. First the author
 *  folders that are one author spelt another way are merged into one. The author folder of a book is the one its main file
 *  is in, else the library's folder for the book, else the author the files say; with none of these its versions stay
 *  where they are (counted as unfiled). A file already gone is not a failure; every failure is counted by its reason. */
export async function tidyPhoneDuplicates(groups: DuplicateGroup[], approved: Set<string>): Promise<TidyResult> {
  const out: TidyResult = { deleted: 0, moved: 0, failed: 0, gone: 0, unfiled: 0, merged: 0, reasons: {} }
  const fail = (e: unknown) => {
    out.failed++
    const r = failureOf(e)
    out.reasons[r] = (out.reasons[r] ?? 0) + 1
  }
  if (!deviceBooksSupported()) return out
  if (!(await hasDeviceAccess()) && !(await requestDeviceAccess().catch(() => false))) {
    out.failed = groups.reduce((n, g) => n + g.versions.length + g.surplus.filter((f) => approved.has(f.path)).length, 0)
    out.reasons.permission = out.failed
    return out
  }
  // the same author under two spellings is two folders on the phone: one first, so the versions land in the one that stays
  const shelf = await scanDevice([BOOKS_FOLDER]).catch(() => [] as DeviceFile[])
  const merge = await mergePhoneAuthorFolders(shelf)
  // what is on the phone now: a file the check found that was moved or deleted since is gone, not a failure
  const present = await scanDevice([...new Set([...loadSettings().deviceFolders, BOOKS_FOLDER])])
    .then((fs) => new Set(fs.map((f) => f.path)))
    .catch(() => undefined)
  const there = (f: DeviceFile) => !present || present.has(f.path)
  out.merged = merge.merged
  out.failed += merge.failed
  for (const [r, n] of Object.entries(merge.reasons)) out.reasons[r as PhoneFailure] = (out.reasons[r as PhoneFailure] ?? 0) + n
  const now = (f: DeviceFile): DeviceFile => {
    const to = merge.moved.get(f.path)
    return to ? { ...f, path: to, name: baseName(to) } : f
  }
  const names = await phoneDirNames()
  const library = await listBooks()
  for (const g0 of groups) {
    const g = { ...g0, keep: now(g0.keep), versions: g0.versions.map(now), surplus: g0.surplus.map(now) }
    for (const f of g0.surplus.filter((x) => approved.has(x.path)).map(now)) {
      if (!there(f)) {
        out.gone++
        continue
      }
      try {
        await call('remove', { path: f.path })
        await repointPhoneFile(f.path)
        out.deleted++
      } catch (e) {
        if (e instanceof Error && e.message === 'missing') out.gone++
        else fail(e)
      }
    }
    const known = library.find((b) => sameBookOnPhone({ title: g.title, author: g.author }, b))
    const author = authorDirOf(g.keep.path) ?? (known ? bookPhoneDir(known, names) : g.author ? bookPhoneDir({ author: g.author }, names) : undefined)
    if (!author) {
      out.unfiled += g.versions.length
      continue
    }
    for (const v of g.versions) {
      if (!there(v)) {
        out.gone++
        continue
      }
      const ext = v.name.slice(v.name.lastIndexOf('.') + 1).toLowerCase()
      const title = known ? bookFileName(known, ext) : `${safeFileName(g.title, 'book')}.${ext}`
      try {
        const res = await call<DeviceFile>('place', { path: v.path, name: title, dir: `${author}/${VERSIONS_DIR}/${ext.toUpperCase()}` })
        await markSeen([res]).catch(() => {})
        await repointPhoneFile(v.path, res.path)
        if (known) await set(res.path, known.id, versionFilesStore).catch(() => {})
        out.moved++
      } catch (e) {
        if (e instanceof Error && e.message === 'missing') out.gone++
        else fail(e)
      }
    }
  }
  await removeEmptyPhoneFolders()
  return out
}

const isPdfPath = (path: string) => path.toLowerCase().endsWith('.pdf')

/** whether the installed app can delete a file in the books folder: an older APK has no `remove`, and a probe with no path
 *  is refused by the method itself ("remove") but by the bridge (anything else) when the method is missing */
let canRemove: Promise<boolean> | undefined
const removeSupported = () =>
  (canRemove ??= call('remove', { path: '' }).then(
    () => true,
    (e: unknown) => e instanceof Error && ['remove', 'outside', 'missing', 'notbook'].includes(e.message),
  ))

/** A book converted from a PDF is read as its EPUB, so in the books folder the EPUB is the book's file: it is written next
 *  to the PDF, the book is tied to it, and the PDF is deleted. Left as it is on an older APK that cannot delete, so the
 *  folder never holds both. */
async function replacePdfWithEpub(id: string, names: Map<string, string>): Promise<void> {
  const pdf = await phoneFileOf(id)
  if (!pdf || !isPdfPath(pdf) || !(await removeSupported())) return
  const rec = await getBook(id)
  if (!rec?.fromPdf) return
  await writeToPhone(id, rec.file, bookFileName(rec), bookPhoneDir(rec, names))
  await call('remove', { path: pdf }).catch(() => {})
}

/** Removes the empty sub-folders of the books folder (left by books moved to another folder, or by a spelling of an
 *  author that was merged). Quiet: an older app version without the native method, or no access, just leaves them. */
const removeEmptyPhoneFolders = () => (deviceBooksSupported() ? call('pruneEmptyFolders').then(() => undefined, () => undefined) : Promise.resolve())

/** After a book is added: with the books folder on, its file goes there. Quiet: a failure is retried by "organise all". */
export async function placeNewBook(id: string): Promise<void> {
  if (!deviceBooksSupported() || !libraryFolderOn()) return
  if (!(await hasDeviceAccess())) return
  await placeBooksOnPhone([id]).catch(() => {})
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
  if (libraryFolderOn()) await removeEmptyPhoneFolders()
  return renamed
}

/** the same, once after the update that fixed the index, then on demand */
const REFRESHED_KEY = 'reader:phoneIndexRefreshed2'
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
  loadSettings().phoneRenameSync || loadSettings().phoneLibraryFolder ? syncPhoneNames(ids) : Promise.resolve({ renamed: 0, failed: 0 })

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
