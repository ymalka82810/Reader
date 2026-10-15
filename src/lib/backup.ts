import {
  getAllProgress,
  getNotes,
  listBooks,
  mergeProgress,
  saveBook,
  saveNotes,
  type Annotation,
  type BookRecord,
  type Progress,
} from './db'
import { loadSettings, saveSettings, type Settings } from './settings'

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
}

const BACKUP_KEY = 'reader:lastBackup'
const SINCE_KEY = 'reader:backupSince'
const REMIND_AFTER_MS = 14 * 24 * 3600 * 1000

export function markBackedUp() {
  try {
    localStorage.setItem(BACKUP_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

/** true when the library has gone more than two weeks without a backup (counted from first use if never backed up) */
export function backupDue(): boolean {
  try {
    const last = Number(localStorage.getItem(BACKUP_KEY)) || 0
    if (last) return Date.now() - last > REMIND_AFTER_MS
    let since = Number(localStorage.getItem(SINCE_KEY)) || 0
    if (!since) {
      since = Date.now()
      localStorage.setItem(SINCE_KEY, String(since))
    }
    return Date.now() - since > REMIND_AFTER_MS
  } catch {
    return false
  }
}

export async function exportLibrary(onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const books = await listBooks()
  const parts: BlobPart[] = []
  const manifestBooks: ManifestBook[] = []
  const notes: Record<string, Annotation[]> = {}
  let offset = 0

  for (let i = 0; i < books.length; i++) {
    const { file, cover, ...rest } = books[i]
    const fileBytes = await file.arrayBuffer()
    parts.push(fileBytes)
    const fileRange: [number, number] = [offset, offset + fileBytes.byteLength]
    offset += fileBytes.byteLength

    let coverRange: [number, number] | undefined
    let coverType: string | undefined
    if (cover) {
      const coverBytes = await cover.arrayBuffer()
      parts.push(coverBytes)
      coverRange = [offset, offset + coverBytes.byteLength]
      coverType = cover.type
      offset += coverBytes.byteLength
    }

    const bookNotes = await getNotes(rest.id)
    if (bookNotes.length) notes[rest.id] = bookNotes
    manifestBooks.push({ ...rest, fileType: file.type, fileRange, coverType, coverRange })
    onProgress?.(i + 1, books.length)
  }

  const manifest: Manifest = {
    version: 1,
    books: manifestBooks,
    notes,
    progress: await getAllProgress(),
    settings: loadSettings(),
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(manifest))
  const lenPrefix = new Uint8Array(4)
  new DataView(lenPrefix.buffer).setUint32(0, headerBytes.byteLength, true)

  return new Blob([lenPrefix, headerBytes, ...parts], { type: 'application/octet-stream' })
}

export async function importLibrary(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const buf = await file.arrayBuffer()
  const headerLen = new DataView(buf, 0, 4).getUint32(0, true)
  const headerStart = 4
  const header: Manifest = JSON.parse(
    new TextDecoder().decode(buf.slice(headerStart, headerStart + headerLen)),
  )
  if (header.version !== 1) throw new Error('קובץ גיבוי לא נתמך')
  const base = headerStart + headerLen

  for (let i = 0; i < header.books.length; i++) {
    const { fileType, fileRange, coverType, coverRange, ...rest } = header.books[i]
    const fileBlob = new Blob([buf.slice(base + fileRange[0], base + fileRange[1])], { type: fileType })
    const coverBlob = coverRange
      ? new Blob([buf.slice(base + coverRange[0], base + coverRange[1])], { type: coverType })
      : undefined
    const rec: BookRecord = { ...rest, file: fileBlob, cover: coverBlob }
    await saveBook(rec)
    // newest reading position wins, so restoring an old backup never rewinds a book
    const prog = header.progress?.[rec.id] ?? (rec.cfi ? { cfi: rec.cfi, fraction: rec.fraction ?? 0, lastOpened: rec.lastOpened ?? rec.addedAt } : undefined)
    if (prog) await mergeProgress(rec.id, prog)
    const incoming = header.notes?.[rec.id]
    if (incoming?.length) {
      // merge with notes already on this device, keeping one copy of each
      const byId = new Map((await getNotes(rec.id)).map((n) => [n.id, n]))
      for (const n of incoming) byId.set(n.id, n)
      await saveNotes(rec.id, [...byId.values()])
    }
    onProgress?.(i + 1, header.books.length)
  }
  if (header.settings) saveSettings({ ...loadSettings(), ...header.settings })
  return header.books.length
}
