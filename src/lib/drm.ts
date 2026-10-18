/** EPUB algorithms that only scramble embedded fonts: not DRM, and foliate-js undoes them. */
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']

/** PalmDOC header: offset of record 0 sits in the first record-info entry, the encryption type 12 bytes into it. */
const PDB_FIRST_RECORD = 78
const PALMDOC_ENCRYPTION = 12

/** does this EPUB (a zip) hold content locked by Adobe ADEPT, Apple FairPlay, Readium LCP or the like? */
export async function isDrmEpub(file: Blob): Promise<boolean> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  if (zip.file('META-INF/rights.xml') || zip.file('META-INF/sinf.xml') || zip.file('META-INF/license.lcpl')) return true
  const xml = await zip.file('META-INF/encryption.xml')?.async('string')
  if (!xml) return false
  const algorithms = [...xml.matchAll(/<(?:\w+:)?EncryptionMethod\b[^>]*\bAlgorithm\s*=\s*["']([^"']+)["']/g)]
  return algorithms.some((m) => !FONT_OBFUSCATION.includes(m[1] ?? ''))
}

/** does this MOBI/AZW/AZW3 header declare Mobipocket or Kindle encryption? */
export async function isDrmMobi(file: Blob): Promise<boolean> {
  const head = new DataView(await file.slice(0, PDB_FIRST_RECORD + 4).arrayBuffer())
  if (head.byteLength < PDB_FIRST_RECORD + 4) return false
  const record0 = head.getUint32(PDB_FIRST_RECORD)
  if (record0 + PALMDOC_ENCRYPTION + 2 > file.size) return false
  const enc = new DataView(await file.slice(record0 + PALMDOC_ENCRYPTION, record0 + PALMDOC_ENCRYPTION + 2).arrayBuffer())
  return enc.getUint16(0) !== 0
}
