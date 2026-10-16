import { getAllProgress, getFile, getNotes, listBooks, type Annotation } from './db'
import { loadStats } from './stats'
import { loadSettings } from './settings'
import { encryptBlob, encryptChunks } from './encrypt'
import type { Manifest, ManifestBook } from './backupManifest'

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
