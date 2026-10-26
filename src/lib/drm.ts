/** EPUB algorithms that only scramble embedded fonts: not DRM, and foliate-js undoes them. */
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']

/** PalmDOC header: offset of record 0 sits in the first record-info entry, the encryption type 12 bytes into it. */
const PDB_FIRST_RECORD = 78
const PALMDOC_ENCRYPTION = 12

/** embedded fonts: scrambling them (even by an algorithm we do not know) leaves the text of the book readable */
const FONT_FILE = /\.(otf|ttf|ttc|woff2?|eot)$/i

/** an algorithm URI as the spec writes it: stray spaces, line breaks or invisible characters around it do not change it */
const cleanAlgorithm = (a: string) => a.replace(/[\s\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '').toLowerCase()
const OBFUSCATION = FONT_OBFUSCATION.map(cleanAlgorithm)

/** an algorithm URI with every character that is not plain printable ASCII spelled out, for a message that shows what was really read */
const spelled = (a: string) => [...a].map((c) => (c < '!' || c > '~' ? `U+${c.charCodeAt(0).toString(16).toUpperCase()}` : c)).join('')

/** why this EPUB (a zip) counts as locked by Adobe ADEPT, Apple FairPlay, Readium LCP or the like; null when it is DRM-free */
export async function drmEpubReason(file: Blob): Promise<string | null> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  for (const name of ['META-INF/rights.xml', 'META-INF/sinf.xml', 'META-INF/license.lcpl'])
    if (zip.file(name)) return name
  const xml = await zip.file('META-INF/encryption.xml')?.async('string')
  if (!xml) return null
  // each <EncryptedData> names one algorithm and the file it was applied to; only text, images and the like count as locked content
  const blocks = xml.match(/<(?:\w+:)?EncryptedData\b[\s\S]*?<\/(?:\w+:)?EncryptedData>/g) ?? [xml]
  for (const block of blocks) {
    const alg = block.match(/<(?:\w+:)?EncryptionMethod\b[^>]*\bAlgorithm\s*=\s*["']([^"']+)["']/)?.[1]
    if (alg === undefined || OBFUSCATION.includes(cleanAlgorithm(alg))) continue
    const uri = block.match(/<(?:\w+:)?CipherReference\b[^>]*\bURI\s*=\s*["']([^"']+)["']/)?.[1]
    if (uri !== undefined && FONT_FILE.test(uri.split(/[?#]/)[0] ?? '')) continue
    return spelled(alg)
  }
  return null
}

/** does this EPUB (a zip) hold content locked by Adobe ADEPT, Apple FairPlay, Readium LCP or the like? */
export async function isDrmEpub(file: Blob): Promise<boolean> {
  return (await drmEpubReason(file)) !== null
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
