const DC_NS = 'http://purl.org/dc/elements/1.1/'

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * foliate-js assumes every EPUB declares at least one Dublin Core element (title, identifier…) in the OPF
 * metadata. A package with an empty <metadata> makes it throw ("Object.groupBy called on null") and the book
 * cannot be opened at all. Some publishers' files are built that way.
 *
 * Returns the same file when it is fine (or is not a readable EPUB: the real import reports that), or a copy
 * whose metadata carries a title and an identifier. The title is the file name, which the import then refines.
 */
export async function repairEpub(file: File): Promise<File> {
  try {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(file)
    const container = await zip.file('META-INF/container.xml')?.async('string')
    if (!container) return file
    const opfPath = /<(?:\w+:)?rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/.exec(container)?.[1]
    const opfFile = opfPath ? zip.file(decodeURI(opfPath)) : null
    if (!opfPath || !opfFile) return file
    const opf = await opfFile.async('string')

    const doc = new DOMParser().parseFromString(opf.replace(/^\uFEFF/, ''), 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) return file
    if (doc.getElementsByTagNameNS(DC_NS, '*').length > 0) return file

    const title = xmlEscape(file.name.replace(/\.[^.]+$/, ''))
    const id = doc.documentElement.getAttribute('unique-identifier') || 'bookid'
    const dc =
      `<dc:identifier xmlns:dc="${DC_NS}" id="${xmlEscape(id)}">urn:reader:${title}</dc:identifier>` +
      `<dc:title xmlns:dc="${DC_NS}">${title}</dc:title>`
    const patched = /<(?:\w+:)?metadata\b[^>]*\/>/.test(opf)
      ? opf.replace(/<((?:\w+:)?metadata\b[^>]*?)\s*\/>/, `<$1>${dc}</metadata>`)
      : opf.replace(/(<(?:\w+:)?metadata\b[^>]*>)/, `$1${dc}`)
    if (patched === opf) return file

    // keep the mimetype entry first and uncompressed, as the EPUB container format requires
    zip.file(decodeURI(opfPath), patched)
    const mime = await zip.file('mimetype')?.async('string')
    if (mime !== undefined) zip.file('mimetype', mime, { compression: 'STORE' })
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' })
    return new File([blob], file.name, { type: 'application/epub+zip' })
  } catch {
    return file
  }
}
