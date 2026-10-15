import {
  getAllProgress,
  getNotes,
  getFile,
  hasBook,
  listBooks,
  mergeProgress,
  saveBook,
  saveNotes,
  type Annotation,
  type BookRecord,
  type Progress,
} from './db'
import { sameBook } from './sameBook'
import { loadStats, mergeStats, type Stats } from './stats'
import { loadSettings, saveSettings, type Settings } from './settings'
import { decryptStream, encryptBlob, encryptChunks, isEncrypted, PasswordRequiredError } from './encrypt'

/** Container format: [4-byte LE header length][JSON header][concatenated blob bytes].
 *  Keeps the whole library (files, covers, metadata, reading progress) in one file,
 *  with no dependency on a zip library. */

interface ManifestBook extends Omit<BookRecord, 'file' | 'cover'> {
  fileType: string
  fileRange: [number, number]
  coverType?: string
  coverRange?: [number, number]
}

interface Manifest {
  version: 1
  books: ManifestBook[]
  /** highlights/bookmarks per book id (absent in backups made before annotations existed) */
  notes?: Record<string, Annotation[]>
  /** reading positions per book id (older backups carry them inside each book instead) */
  progress?: Record<string, Progress>
  /** display settings of the device that made the backup */
  settings?: Settings
  /** reading-speed stats per book id */
  stats?: Record<string, Stats>
}

const BACKUP_KEY = 'reader:lastBackup'
const SINCE_KEY = 'reader:backupSince'
const REMIND_AFTER_MS = 14 * 24 * 3600 * 1000
const URGENT_REMIND_AFTER_MS = 3 * 24 * 3600 * 1000

export function markBackedUp() {
  try {
    localStorage.setItem(BACKUP_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

/** true when the library has gone more than two weeks without a backup (counted from first use if never backed up) */
export function backupDue(urgent = false): boolean {
  const limit = urgent ? URGENT_REMIND_AFTER_MS : REMIND_AFTER_MS
  try {
    const last = Number(localStorage.getItem(BACKUP_KEY)) || 0
    if (last) return Date.now() - last > limit
    let since = Number(localStorage.getItem(SINCE_KEY)) || 0
    if (!since) {
      since = Date.now()
      localStorage.setItem(SINCE_KEY, String(since))
    }
    return Date.now() - since > limit
  } catch {
    return false
  }
}

/** total bytes of book files and covers, to warn before building a backup too big for memory */
export async function librarySize(): Promise<number> {
  let sum = 0
  for (const b of await listBooks()) sum += ((await getFile(b.id))?.size ?? 0) + (b.cover?.size ?? 0)
  return sum
}

/** `password` (optional) encrypts the whole file with AES-GCM, see encrypt.ts */
export async function exportLibrary(
  onProgress?: (done: number, total: number) => void,
  password?: string,
): Promise<Blob> {
  const plain = await buildPlain(onProgress)
  return password ? encryptBlob(plain, password) : plain
}

/** like exportLibrary, but writes straight into `sink` (e.g. from showSaveFilePicker) in small pieces,
 *  so memory stays bounded however large the library is */
export async function exportLibraryTo(
  sink: {
    write(data: BufferSource): Promise<unknown>
    close(): Promise<unknown>
    abort?(): Promise<unknown>
  },
  onProgress?: (done: number, total: number) => void,
  password?: string,
): Promise<void> {
  try {
    const plain = await buildPlain(onProgress)
    if (password) {
      for await (const part of encryptChunks(plain, password)) await sink.write(part)
    } else {
      for (let off = 0; off < plain.size; off += 4 * 1024 * 1024) {
        await sink.write(await plain.slice(off, off + 4 * 1024 * 1024).arrayBuffer())
      }
    }
    await sink.close()
  } catch (e) {
    await sink.abort?.().catch(() => {})
    throw e
  }
}

async function buildPlain(onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const books = await listBooks()
  const parts: BlobPart[] = []
  const manifestBooks: ManifestBook[] = []
  const notes: Record<string, Annotation[]> = {}
  let offset = 0

  for (let i = 0; i < books.length; i++) {
    const { cover, ...rest } = books[i]!
    const file = await getFile(rest.id)
    if (!file) continue
    parts.push(file)
    const fileRange: [number, number] = [offset, offset + file.size]
    offset += file.size

    let coverRange: [number, number] | undefined
    let coverType: string | undefined
    if (cover) {
      parts.push(cover)
      coverRange = [offset, offset + cover.size]
      coverType = cover.type
      offset += cover.size
    }

    const bookNotes = await getNotes(rest.id)
    if (bookNotes.length) notes[rest.id] = bookNotes
    manifestBooks.push({
      ...rest,
      fileType: file.type,
      fileRange,
      coverType,
      coverRange,
    })
    onProgress?.(i + 1, books.length)
  }

  const manifest: Manifest = {
    version: 1,
    books: manifestBooks,
    notes,
    progress: await getAllProgress(),
    settings: loadSettings(),
    stats: Object.fromEntries(
      (await Promise.all(books.map(async (b) => [b.id, await loadStats(b.id)] as const))).filter(([, s]) => s.secs > 0),
    ),
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(manifest))
  const lenPrefix = new Uint8Array(4)
  new DataView(lenPrefix.buffer).setUint32(0, headerBytes.byteLength, true)

  return new Blob([lenPrefix, headerBytes, ...parts], {
    type: 'application/octet-stream',
  })
}

const CORRUPT = 'קובץ הגיבוי פגום'

/** where the backup's plaintext comes from: `take` returns bytes [start, end) */
interface BackupReader {
  size: number
  take(start: number, end: number, type?: string): Promise<Blob>
}

const blobReader = (b: Blob): BackupReader => ({ size: b.size, take: async (s, e, t) => b.slice(s, e, t) })

/** reads a decrypting stream front to back; requests must come in ascending order, and only the bytes
 *  of the requested range are ever held in memory */
function streamReader(size: number, chunks: AsyncIterable<Uint8Array<ArrayBuffer>>): BackupReader {
  const it = chunks[Symbol.asyncIterator]()
  let pos = 0
  let pending = new Uint8Array(0)
  return {
    size,
    async take(start, end, type) {
      if (start < pos) throw new Error(CORRUPT)
      const parts: Uint8Array<ArrayBuffer>[] = []
      while (pos < end) {
        if (!pending.length) {
          const next = await it.next()
          if (next.done) throw new Error(CORRUPT)
          pending = next.value
          continue
        }
        const n = Math.min(pending.length, end - pos)
        const skip = Math.max(0, start - pos)
        if (skip < n) parts.push(pending.slice(skip, n))
        pending = pending.subarray(n)
        pos += n
      }
      return new Blob(parts, type ? { type } : undefined)
    },
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function checkRange(v: unknown, bodySize: number): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) throw new Error(CORRUPT)
  const [a, b] = v as unknown[]
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new Error(CORRUPT)
  if ((a as number) < 0 || (a as number) > (b as number) || (b as number) > bodySize) throw new Error(CORRUPT)
  return [a as number, b as number]
}

/** parses and validates the manifest; `bodySize` is the number of bytes after the header, which every range must fit in */
export function parseManifest(text: string, bodySize: number): Manifest {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(CORRUPT)
  }
  if (!isObj(raw) || !Array.isArray(raw.books)) throw new Error(CORRUPT)
  if (raw.version !== 1) throw new Error('קובץ גיבוי לא נתמך')
  const books = raw.books.map((b: unknown): ManifestBook => {
    if (!isObj(b) || typeof b.id !== 'string' || !b.id || typeof b.title !== 'string') throw new Error(CORRUPT)
    const fileRange = checkRange(b.fileRange, bodySize)
    const coverRange = b.coverRange === undefined ? undefined : checkRange(b.coverRange, bodySize)
    return {
      ...(b as unknown as ManifestBook),
      author: typeof b.author === 'string' ? b.author : '',
      fileName: typeof b.fileName === 'string' ? b.fileName : `${b.id}.epub`,
      addedAt: Number.isFinite(b.addedAt) ? (b.addedAt as number) : Date.now(),
      fileType: typeof b.fileType === 'string' ? b.fileType : '',
      coverType: typeof b.coverType === 'string' ? b.coverType : undefined,
      fileRange,
      coverRange,
    }
  })
  const notes: Record<string, Annotation[]> = {}
  if (isObj(raw.notes)) for (const [id, list] of Object.entries(raw.notes)) if (Array.isArray(list)) notes[id] = list
  return {
    version: 1,
    books,
    notes,
    progress: isObj(raw.progress) ? (raw.progress as Manifest['progress']) : undefined,
    settings: isObj(raw.settings) ? (raw.settings as unknown as Settings) : undefined,
    stats: isObj(raw.stats) ? (raw.stats as Manifest['stats']) : undefined,
  }
}

/** `restored` counts books added or merged into the library; `skipped` counts backup books left out because the
 *  library already holds the same title and author under another id (another format or file name), the same
 *  rule as a normal import. Throws PasswordRequiredError for an encrypted backup given no password,
 *  WrongPasswordError for a bad one. */
export async function importLibrary(
  source: Blob,
  onProgress?: (done: number, total: number) => void,
  password?: string,
): Promise<{ restored: number; skipped: number }> {
  let reader: BackupReader
  if (await isEncrypted(source)) {
    if (!password) throw new PasswordRequiredError()
    // decrypt chunk by chunk while importing, so a multi-GB library never sits in memory at once
    const { size, chunks } = await decryptStream(source, password)
    reader = streamReader(size, chunks)
  } else {
    reader = blobReader(source)
  }
  // read only the header into memory; book files are taken one at a time
  if (reader.size < 4) throw new Error(CORRUPT)
  const headerLen = new DataView(await (await reader.take(0, 4)).arrayBuffer()).getUint32(0, true)
  const headerStart = 4
  if (headerStart + headerLen > reader.size) throw new Error(CORRUPT)
  const base = headerStart + headerLen
  const header = parseManifest(await (await reader.take(headerStart, base)).text(), reader.size - base)

  let done = 0
  let skipped = 0
  // titles already in the library, extended as books are restored so duplicates inside the backup are caught too
  const known = await listBooks()
  try {
    for (let i = 0; i < header.books.length; i++) {
      const { fileType, fileRange, coverType, coverRange, ...rest } = header.books[i]!
      // same id = the very same book, merged below; a different id with the same title and author is a duplicate
      if (!(await hasBook(rest.id)) && known.some((b) => sameBook(b, rest))) {
        skipped++
        done = i + 1
        onProgress?.(done, header.books.length)
        continue
      }
      const fileBlob = await reader.take(base + fileRange[0], base + fileRange[1], fileType)
      const coverBlob = coverRange ? await reader.take(base + coverRange[0], base + coverRange[1], coverType) : undefined
      const rec: BookRecord = { ...rest, file: fileBlob, cover: coverBlob }
      await saveBook(rec)
      if (!known.some((b) => b.id === rec.id)) known.push(rec)
      // newest reading position wins, so restoring an old backup never rewinds a book
      const prog =
        header.progress?.[rec.id] ??
        (rec.cfi
          ? {
              cfi: rec.cfi,
              fraction: rec.fraction ?? 0,
              lastOpened: rec.lastOpened ?? rec.addedAt,
            }
          : undefined)
      if (prog) await mergeProgress(rec.id, prog)
      const incoming = header.notes?.[rec.id]
      if (incoming?.length) {
        // merge with notes already on this device, keeping one copy of each
        const byId = new Map((await getNotes(rec.id)).map((n) => [n.id, n]))
        for (const n of incoming) byId.set(n.id, n)
        await saveNotes(rec.id, [...byId.values()])
      }
      const st = header.stats?.[rec.id]
      if (st) await mergeStats(rec.id, st)
      done = i + 1
      onProgress?.(done, header.books.length)
    }
  } catch (e) {
    // books are restored one by one and merging is idempotent, so importing the same file again finishes the job
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`${msg} (שוחזרו ${done} מתוך ${header.books.length} ספרים — אפשר לייבא שוב את אותו הקובץ להשלמה)`)
  }
  if (header.settings) saveSettings({ ...loadSettings(), ...header.settings })
  return { restored: header.books.length - skipped, skipped }
}
