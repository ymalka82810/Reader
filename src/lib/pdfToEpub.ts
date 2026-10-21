import { t } from '../i18n'
import { ImportError } from './errors'
import type { ExtractedPdf } from './pdfToBook'
import { tick } from './wordCount'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// characters that are illegal in XML 1.0
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`

// Namespace URIs are assembled at runtime: some HTTPS-inspecting content filters (e.g. NetSpark)
// blank out URL literals inside served JS, which corrupted the generated content.opf.
const ns = (host: string, path: string) => ['http:', '', host, path].join('/')
const NS_XHTML = ns('www.w3.org', '1999/xhtml')
const NS_OPS = ns('www.idpf.org', '2007/ops')
const NS_OPF = ns('www.idpf.org', '2007/opf')
const NS_NCX = ns('www.daisy.org', 'z3986/2005/ncx/')
const NS_DC = ns('purl.org', 'dc/elements/1.1/')

const CSS = `body { margin: 0; }
p { margin: 0 0 0.8em; }
figure { margin: 1em 0; text-align: center; }
figure img { max-width: 100%; max-height: 90vh; }
figcaption { font-size: 0.8em; opacity: 0.7; }
`

/** Build a real EPUB 3 file (zip) from text extracted out of a PDF. */
export async function buildEpub(x: ExtractedPdf, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted()
  const lang = x.rtl ? 'he' : 'en'
  const dir = x.rtl ? 'rtl' : 'ltr'
  const title = clean(x.title) || 'Untitled'

  const chapters = x.chapters
    .map((c, i) => ({
      id: `c${i}`,
      file: `c${i}.xhtml`,
      label: clean(c.title),
      paras: c.paras,
      images: (c.pageImages ?? []).map((p) => ({ ...p, file: `img/p${p.page}.jpg`, id: `c${i}img${p.page}` })),
    }))
    .filter((c) => c.paras.length > 0 || c.images.length > 0)
  if (!chapters.length) throw new ImportError(t('pdf.noConvertible'))

  const bookId = `urn:uuid:${uuid()}`
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  const { default: JSZip } = await import('jszip')
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
  if (x.cover) zip.file('OEBPS/cover.jpg', x.cover)

  let built = 0
  for (const c of chapters) {
    // a long book is built in slices, so a cancel takes effect and the page stays responsive
    if (++built % 25 === 0) {
      await tick()
      signal?.throwIfAborted()
    }
    for (const im of c.images) zip.file(`OEBPS/${im.file}`, im.image)
    const text = c.paras.map((p) => `<p>${esc(clean(p))}</p>`).join('\n')
    // pages the text conversion handled badly: the original page, so nothing is lost
    const pics = c.images
      .map(
        (im) =>
          `<figure><img src="${im.file}" alt="${t('pdf.original', { page: im.page })}"/><figcaption>${t('pdf.original', { page: im.page })}</figcaption></figure>`,
      )
      .join('\n')
    const body = [text, pics].filter(Boolean).join('\n')
    zip.file(
      `OEBPS/${c.file}`,
      `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="${NS_XHTML}" xml:lang="${lang}" lang="${lang}" dir="${dir}">
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
<html xmlns="${NS_XHTML}" xmlns:epub="${NS_OPS}" xml:lang="${lang}" lang="${lang}" dir="${dir}">
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
<ncx xmlns="${NS_NCX}" version="2005-1">
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
<package xmlns="${NS_OPF}" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="${NS_DC}">
<dc:identifier id="bookid">${esc(bookId)}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
<dc:language>${lang}</dc:language>${x.author ? `\n<dc:creator>${esc(clean(x.author))}</dc:creator>` : ''}
<meta property="dcterms:modified">${modified}</meta>${x.cover ? '\n<meta name="cover" content="cover-image"/>' : ''}
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>${x.cover ? '\n<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>' : ''}
${chapters.map((c) => `<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}${chapters.flatMap((c) => c.images.map((im) => `\n<item id="${im.id}" href="${im.file}" media-type="image/jpeg"/>`)).join('')}
</manifest>
<spine toc="ncx" page-progression-direction="${dir}">
${chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n')}
</spine>
</package>`,
  )

  signal?.throwIfAborted()
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'STORE',
  })
}
