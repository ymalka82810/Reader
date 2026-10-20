import type JSZip from 'jszip'

const DC_NS = 'http://purl.org/dc/elements/1.1/'

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const MEDIA_TYPES: Record<string, string> = {
  xhtml: 'application/xhtml+xml',
  html: 'application/xhtml+xml',
  htm: 'application/xhtml+xml',
  css: 'text/css',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ncx: 'application/x-dtbncx+xml',
}
const ext = (path: string) => /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''
const isPage = (path: string) => MEDIA_TYPES[ext(path)] === 'application/xhtml+xml'

/** `href` resolved against the folder `base` ("EPUB" or ""), without a fragment or a query; null when it leaves the book */
function resolveIn(base: string, href: string): string | null {
  const parts = base ? base.split('/') : []
  for (const seg of decodeURI(href.split(/[#?]/)[0] ?? '').split('/')) {
    if (seg === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

const parseXml = (text: string) => {
  const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml')
  return doc.getElementsByTagName('parsererror').length ? null : doc
}

/**
 * Some files lose their package document (content.opf) but keep the pages and the table of contents. Without it
 * no reader can open the book, so a new one is written from what is left: every file in the manifest, the pages in
 * the order of the table of contents (toc.ncx, or the nav page) and the pages the table does not mention after them.
 * Pages the table lists but the file no longer holds are left out. Returns null when there is nothing to read.
 */
async function rebuildPackage(zip: JSZip, opfPath: string, fileName: string): Promise<string | null> {
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''
  const prefix = dir ? dir + '/' : ''
  const names = Object.values(zip.files)
    .filter((f) => !f.dir && f.name.startsWith(prefix) && f.name !== opfPath && MEDIA_TYPES[ext(f.name)])
    .map((f) => f.name)
  const inBook = new Set(names)
  if (!names.some(isPage)) return null

  const hrefsOf = (doc: Document, selector: string, attr: string, base: string) =>
    [...doc.querySelectorAll(selector)]
      .map((el) => resolveIn(base, el.getAttribute(attr) ?? ''))
      .filter((p): p is string => !!p && inBook.has(p) && isPage(p))
  const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

  const ncxPath = names.find((n) => ext(n) === 'ncx')
  const ncx = ncxPath ? parseXml((await zip.file(ncxPath)?.async('string')) ?? '') : null
  let navPath: string | undefined
  for (const n of names.filter((n) => isPage(n) && /toc|nav/i.test(n))) {
    if (/epub:type\s*=\s*["']toc["']/.test((await zip.file(n)?.async('string')) ?? '')) {
      navPath = n
      break
    }
  }
  const nav = navPath ? parseXml((await zip.file(navPath)?.async('string')) ?? '') : null

  let order: string[] = []
  if (ncx && ncxPath) order = hrefsOf(ncx, 'navPoint > content, navPoint content', 'src', folderOf(ncxPath))
  if (!order.length && nav && navPath) order = hrefsOf(nav, 'nav a[href]', 'href', folderOf(navPath))
  const seen = new Set<string>()
  const spine = [...order, ...names.filter((n) => isPage(n) && n !== navPath)].filter((n) => {
    if (seen.has(n)) return false
    seen.add(n)
    return true
  })

  const id = new Map(names.map((n, i) => [n, `f${i}`]))
  const rel = (n: string) => xmlEscape(n.slice(prefix.length))
  const manifest = names
    .map((n) => {
      const props = n === navPath ? ' properties="nav"' : /(^|\/)cover[^/]*\.(png|jpe?g|gif|webp|svg)$/i.test(n) ? ' properties="cover-image"' : ''
      return `<item id="${id.get(n)}" href="${rel(n)}" media-type="${MEDIA_TYPES[ext(n)]}"${props}/>`
    })
    .join('\n    ')
  const itemrefs = spine.map((n) => `<itemref idref="${id.get(n)}"/>`).join('\n    ')

  const docTitle = ncx?.querySelector('docTitle text')?.textContent?.trim()
  const title = xmlEscape(docTitle || fileName.replace(/\.[^.]+$/, ''))
  const uid = xmlEscape(ncx?.querySelector('meta[name="dtb:uid"]')?.getAttribute('content') || `urn:reader:${title}`)
  const ncxId = ncxPath ? id.get(ncxPath) : undefined
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="${DC_NS}">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${title}</dc:title>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine${ncxId ? ` toc="${ncxId}"` : ''}>
    ${itemrefs}
  </spine>
</package>`
}

/** gives an OPF with no Dublin Core element a title and an identifier; null when it already has some or is unreadable */
function addMetadata(opf: string, fileName: string): string | null {
  const doc = parseXml(opf)
  if (!doc || doc.getElementsByTagNameNS(DC_NS, '*').length > 0) return null
  const title = xmlEscape(fileName.replace(/\.[^.]+$/, ''))
  const id = doc.documentElement.getAttribute('unique-identifier') || 'bookid'
  const dc =
    `<dc:identifier xmlns:dc="${DC_NS}" id="${xmlEscape(id)}">urn:reader:${title}</dc:identifier>` +
    `<dc:title xmlns:dc="${DC_NS}">${title}</dc:title>`
  const patched = /<(?:\w+:)?metadata\b[^>]*\/>/.test(opf)
    ? opf.replace(/<((?:\w+:)?metadata\b[^>]*?)\s*\/>/, `<$1>${dc}</metadata>`)
    : opf.replace(/(<(?:\w+:)?metadata\b[^>]*>)/, `$1${dc}`)
  return patched === opf ? null : patched
}

/**
 * foliate-js cannot open some damaged EPUBs, and the import would just fail:
 *  - an OPF with no Dublin Core element at all makes it throw ("Object.groupBy called on null");
 *    the book gets a title and an identifier;
 *  - a missing OPF (container.xml points at a file the zip does not hold) is written again from the pages
 *    and the table of contents that are left.
 *
 * Returns the same file when it is fine (or is not a readable EPUB: the real import reports that), or a repaired copy.
 * The title is the file name or the table of contents' title, which the import then refines.
 */
export async function repairEpub(file: File): Promise<File> {
  try {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(file)
    const container = await zip.file('META-INF/container.xml')?.async('string')
    if (!container) return file
    const rootfile = /<(?:\w+:)?rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/.exec(container)?.[1]
    if (!rootfile) return file
    const opfPath = decodeURI(rootfile)
    const opfFile = zip.file(opfPath)
    const patched = opfFile ? addMetadata(await opfFile.async('string'), file.name) : await rebuildPackage(zip, opfPath, file.name)
    if (!patched) return file

    // keep the mimetype entry first and uncompressed, as the EPUB container format requires
    zip.file(opfPath, patched)
    const mime = await zip.file('mimetype')?.async('string')
    if (mime !== undefined) zip.file('mimetype', mime, { compression: 'STORE' })
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' })
    return new File([blob], file.name, { type: 'application/epub+zip' })
  } catch {
    return file
  }
}
