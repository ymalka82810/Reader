import { addFolderName, getNotes, hasBook, listBooks, mergeProgress, saveBook, saveNotes, type BookRecord } from './db'
import { sameBook } from './sameBook'
import { mergeStats } from './stats'
import { mergeReadingHours, mergeReadingLog } from './readingLog'
import { mergeReview } from './flashcards'
import { loadSettings, saveSettings } from './settings'
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
    throw new Error(t('backup.partial', { msg, done, total: header.books.length }))
  }
  if (header.readingLog) await mergeReadingLog(header.readingLog)
  if (header.readingHours) await mergeReadingHours(header.readingHours)
  if (header.vocab || header.cardStates) await mergeReview(header.vocab ?? [], header.cardStates ?? {})
  // folders the user created (also empty ones) are merged by name; the font is needed when the settings point at it
  for (const name of header.folders ?? []) await addFolderName(name)
  if (header.customFont) await restoreCustomFont(header.customFont)
  if (header.settings) saveSettings({ ...loadSettings(), ...header.settings })
  return { restored: header.books.length - skipped, skipped }
}
