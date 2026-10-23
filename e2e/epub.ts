import JSZip from 'jszip'

/** a small multi-page EPUB, built on the fly */
export async function makeEpub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  const chapters = [1, 2, 3, 4]
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">e2e-restore</dc:identifier><dc:title>ספר לשחזור</dc:title><dc:creator>מחברת שחזור</dc:creator><dc:language>he</dc:language></metadata>
<manifest>${chapters.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${chapters.map((n) => `<itemref idref="c${n}"/>`).join('')}</spine></package>`,
  )
  const para = 'זהו משפט ארוך למדי שנועד למלא את העמוד בטקסט כדי שיהיו הרבה עמודים בספר הבדיקה. '.repeat(12)
  for (const n of chapters) {
    zip.file(
      `OEBPS/c${n}.xhtml`,
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>פרק ${n}</title></head><body><h1>פרק ${n}</h1>${Array.from({ length: 40 }, () => `<p>${para}</p>`).join('')}</body></html>`,
    )
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}
