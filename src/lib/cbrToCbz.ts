// A comic-book RAR (CBR) is the same pages as a CBZ in another wrapper, and the reader's engine (foliate-js) reads only
// CBZ. So a CBR is unpacked here and packed again as a CBZ, which is then read like any other comic; the images are
// already compressed, so they are stored as they are.
import JSZip from 'jszip'

/** what a CBR needs to be a book: a RAR archive, that is not protected by a password */
export class CbrError extends Error {
  encrypted: boolean
  constructor(message: string, encrypted = false) {
    super(message)
    this.name = 'CbrError'
    this.encrypted = encrypted
  }
}

export const isCbrName = (name: string) => /\.cbr$/i.test(name)

/** the same comic as a CBZ file, named after the CBR (lowercase, as foliate-js picks the format by name) */
export async function cbrToCbz(file: File, signal?: AbortSignal): Promise<File> {
  const [{ createExtractorFromData }, { default: wasmUrl }] = await Promise.all([
    import('node-unrar-js'),
    import('node-unrar-js/esm/js/unrar.wasm?url'),
  ])
  signal?.throwIfAborted()
  const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer()
  const data = await file.arrayBuffer()
  signal?.throwIfAborted()
  const zip = new JSZip()
  let pages = 0
  try {
    const extractor = await createExtractorFromData({ data, wasmBinary })
    for (const f of extractor.extract().files) {
      signal?.throwIfAborted()
      if (f.fileHeader.flags.directory || !f.extraction) continue
      zip.file(f.fileHeader.name, f.extraction, { compression: 'STORE' })
      pages++
    }
  } catch (e) {
    if (signal?.aborted) throw signal.reason
    const msg = e instanceof Error ? e.message : String(e)
    throw new CbrError(msg, /password/i.test(msg))
  }
  if (!pages) throw new CbrError('empty')
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.comicbook+zip' })
  return new File([blob], file.name.replace(/\.cbr$/i, '.cbz').toLowerCase(), { type: 'application/vnd.comicbook+zip' })
}
