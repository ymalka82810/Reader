import JSZip from 'jszip'
import { PAGES_PER_SECTION, type ExtractedPdf } from './pdfToBook'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// characters that are illegal in XML 1.0
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`

const CSS = `body { margin: 0; }
p { margin: 0 0 0.8em; }
`

/** Build a real EPUB 3 file (zip) from text extracted out of a PDF. */
export async function buildEpub(x: ExtractedPdf): Promise<Blob> {
  const lang = x.rtl ? 'he' : 'en'
  const dir = x.rtl ? 'rtl' : 'ltr'
  const title = clean(x.title) || 'Untitled'

  const chapters = x.sections
    .map((paras, i) => ({
      id: `c${i}`,
      file: `c${i}.xhtml`,
      label: `עמודים ${i * PAGES_PER_SECTION + 1}–${Math.min(x.pageCount, (i + 1) * PAGES_PER_SECTION)}`,
      paras,
    }))
    .filter((c) => c.paras.length > 0)
  if (!chapters.length) throw new Error('לא נמצא טקסט להמרה ב-PDF הזה.')

  const bookId = `urn:uuid:${uuid()}`
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  )

  zip.file('OEBPS/style.css', CSS)

  for (const c of chapters) {
    const body = c.paras.map((p) => `<p>${esc(clean(p))}</p>`).join('\n')
    zip.file(
      `OEBPS/${c.file}`,
      `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"/><title>${esc(c.label)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`,
    )
  }

  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"/><title>${esc(title)}</title></head>
<body>
<nav epub:type="toc" id="toc"><ol>
${chapters.map((c) => `<li><a href="${c.file}">${esc(c.label)}</a></li>`).join('\n')}
</ol></nav>
</body>
</html>`,
  )

  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${esc(bookId)}"/></head>
<docTitle><text>${esc(title)}</text></docTitle>
<navMap>
${chapters
  .map(
    (c, i) =>
      `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${esc(c.label)}</text></navLabel><content src="${c.file}"/></navPoint>`,
  )
  .join('\n')}
</navMap>
</ncx>`,
  )

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${esc(bookId)}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
<dc:language>${lang}</dc:language>${x.author ? `\n<dc:creator>${esc(clean(x.author))}</dc:creator>` : ''}
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${chapters.map((c) => `<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx" page-progression-direction="${dir}">
${chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n')}
</spine>
</package>`,
  )

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
  })
}
