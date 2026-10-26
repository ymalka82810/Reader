import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { drmEpubReason, isDrmEpub, isDrmMobi } from './drm'

const enc = (alg: string) =>
  `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/></enc:EncryptedData></encryption>`

const epub = async (files: Record<string, string>) => {
  const zip = new JSZip()
  for (const [name, body] of Object.entries(files)) zip.file(name, body)
  return zip.generateAsync({ type: 'blob' })
}

describe('isDrmEpub', () => {
  const encOf = (alg: string, uri: string) =>
    `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`
  const AES = 'http://www.w3.org/2001/04/xmlenc#aes128-cbc'
  it('accepts font obfuscation whose URI has stray spaces or invisible characters', async () => {
    for (const alg of [' http://www.idpf.org/2008/embedding ', 'http://www.idpf.org/2008/embedding\u200f', 'HTTP://www.idpf.org/2008/embedding\n'])
      expect(await isDrmEpub(await epub({ 'META-INF/encryption.xml': enc(alg) }))).toBe(false)
  })
  it('accepts any algorithm applied only to embedded fonts', async () => {
    expect(await isDrmEpub(await epub({ 'META-INF/encryption.xml': encOf(AES, 'OEBPS/Fonts/Frank.otf') }))).toBe(false)
  })
  it('flags content encryption on text and images, and says which algorithm', async () => {
    expect(await isDrmEpub(await epub({ 'META-INF/encryption.xml': encOf(AES, 'OEBPS/Text/ch1.xhtml') }))).toBe(true)
    expect(await drmEpubReason(await epub({ 'META-INF/encryption.xml': encOf(AES, 'OEBPS/Images/a.jpg') }))).toBe(AES)
  })
  it('accepts a plain EPUB', async () => {
    expect(await isDrmEpub(await epub({ mimetype: 'application/epub+zip' }))).toBe(false)
  })
  it('accepts font obfuscation only', async () => {
    expect(await isDrmEpub(await epub({ 'META-INF/encryption.xml': enc('http://www.idpf.org/2008/embedding') }))).toBe(false)
    expect(await isDrmEpub(await epub({ 'META-INF/encryption.xml': enc('http://ns.adobe.com/pdf/enc#RC') }))).toBe(false)
  })
  it('flags content encryption (Adobe ADEPT / AES)', async () => {
    expect(await isDrmEpub(await epub({ 'META-INF/encryption.xml': enc('http://www.w3.org/2001/04/xmlenc#aes128-cbc') }))).toBe(true)
  })
  it('flags rights.xml, sinf.xml and LCP licenses', async () => {
    for (const f of ['META-INF/rights.xml', 'META-INF/sinf.xml', 'META-INF/license.lcpl'])
      expect(await isDrmEpub(await epub({ [f]: '<x/>' }))).toBe(true)
  })
})

const mobi = (encryption: number) => {
  const b = new Uint8Array(200)
  const v = new DataView(b.buffer)
  v.setUint32(78, 100)
  v.setUint16(100 + 12, encryption)
  return new Blob([b])
}

describe('isDrmMobi', () => {
  it('reads the encryption type from the PalmDOC header', async () => {
    expect(await isDrmMobi(mobi(0))).toBe(false)
    expect(await isDrmMobi(mobi(2))).toBe(true)
  })
  it('ignores files too short to have a header', async () => {
    expect(await isDrmMobi(new Blob(['abc']))).toBe(false)
  })
})
