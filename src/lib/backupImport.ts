import { addFolderName, getNotes, hasBook, listBooks, mergeProgress, saveBook, saveNotes, type BookRecord } from './db'
import { sameBook } from './sameBook'
import { mergeStats } from './stats'
import { mergeReadingHours, mergeReadingLog } from './readingLog'
import { mergePaceData } from './pace'
import { mergeReview } from './flashcards'
import { mergeBackupSettings } from './settings'
import { restoreCustomFont } from './customFont'
import { decryptStream, isEncrypted, PasswordRequiredError } from './encrypt'
import { CORRUPT, parseManifest } from './backupManifest'
import { t } from '../i18n'

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
      const exists = await hasBook(rest.id)
      if (!exists && known.some((b) => sameBook(b, rest))) {
        skipped++
        done = i + 1
        onProgress?.(done, header.books.length)
        continue
      }
      // a book already here keeps its file and details (title, author, tags, folder, read mark), which may have
      // been edited since the backup; only position, notes and stats are merged into it
      if (!exists) {
        // a File with the book's name: the reader tells the formats apart by it, and a bare Blob has none and fails to open
        const fileBlob = new File([await reader.take(base + fileRange[0], base + fileRange[1], fileType)], rest.fileName, { type: fileType })
        const coverBlob = coverRange ? await reader.take(base + coverRange[0], base + coverRange[1], coverType) : undefined
        const rec: BookRecord = { ...rest, file: fileBlob, cover: coverBlob }
        await saveBook(rec)
        known.push(rec)
      }
      // newest reading position wins, so restoring an old backup never rewinds a book
      const prog =
        header.progress?.[rest.id] ??
        (rest.cfi
          ? {
              cfi: rest.cfi,
              fraction: rest.fraction ?? 0,
              lastOpened: rest.lastOpened ?? rest.addedAt,
            }
          : undefined)
      if (prog) await mergeProgress(rest.id, prog)
      const incoming = header.notes?.[rest.id]
      if (incoming?.length) {
        // merge with notes already on this device, keeping one copy of each
        const byId = new Map((await getNotes(rest.id)).map((n) => [n.id, n]))
        for (const n of incoming) byId.set(n.id, n)
        await saveNotes(rest.id, [...byId.values()])
      }
      const st = header.stats?.[rest.id]
      if (st) await mergeStats(rest.id, st)
      done = i + 1
      onProgress?.(done, header.books.length)
    }
  } catch (e) {
    // books are restored one by one and merging is idempotent, so importing the same file again finishes the job
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(t('backup.partial', { msg, done, total: header.books.length }))
  }
  if (header.readingLog) await mergeReadingLog(header.readingLog)
  if (header.readingHours) await mergeReadingHours(header.readingHours)
  if (header.readingPace) mergePaceData(header.readingPace)
  if (header.vocab || header.cardStates) await mergeReview(header.vocab ?? [], header.cardStates ?? {})
  // folders the user created (also empty ones) are merged by name; the font is needed when the settings point at it
  for (const name of header.folders ?? []) await addFolderName(name)
  if (header.customFont) await restoreCustomFont(header.customFont)
  if (header.settings) mergeBackupSettings(header.settings)
  return { restored: header.books.length - skipped, skipped }
}
