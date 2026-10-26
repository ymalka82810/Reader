// A book from the library saved in another format than the one it is kept in: any book with text as an EPUB, a PDF, a
// Word document, plain text or a web page; a comic (CBZ) as an EPUB, a PDF or a web page. Everything runs on the
// device: an EPUB is read from its own zip, a MOBI/AZW/FB2/CBZ through the reader's own engine (foliate-js), and a PDF
// kept as it is goes through the same conversion as on import.
import type { PdfOptions } from './pdfOptions'

import type { BookRecord } from './db'
import { tick } from './wordCount'

/** 'original' is the stored file as it is, whatever its format */
export type BookFormat = 'original' | 'epub' | 'pdf' | 'docx' | 'txt' | 'html'

type Block = { t: 'h'; level: number; text: string } | { t: 'p'; text: string } | { t: 'img'; src: string; alt: string }

/** a book's text in reading order: one list of blocks per section */
export interface BookContent {
  title: string
  author: string
  rtl: boolean
  sections: Block[][]
  /** the images the sections point to, by the path (or URL) they are named by */
  images: Map<string, Blob>
}

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const READABLE = new Set(['mobi', 'azw', 'azw3', 'fb2', 'fbz', 'zip'])

/** what the stored file is: an EPUB, a PDF kept as it is, a MOBI/AZW/FB2, a comic, or something only saved as it is */
export function sourceFormat(b: Pick<BookRecord, 'kind' | 'fileName'>): 'epub' | 'pdf' | 'ebook' | 'comic' | 'other' {
  if (b.kind === 'audio') return 'other'
  const ext = extOf(b.fileName)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'epub' || (!ext && b.kind === 'epub')) return 'epub'
  if (ext === 'cbz') return 'comic'
  if (READABLE.has(ext) || /\.fb2\.zip$/i.test(b.fileName)) return 'ebook'
  return 'other'
}

/** The formats a book can be saved in, the one it is kept in first; empty when it can only be saved as it is. */
export function exportFormats(b: Pick<BookRecord, 'kind' | 'fileName'>): BookFormat[] {
  switch (sourceFormat(b)) {
    case 'epub':
      return ['epub', 'pdf', 'docx', 'txt', 'html']
    case 'pdf':
      return ['pdf', 'epub', 'docx', 'txt', 'html']
    case 'ebook':
      return ['original', 'epub', 'pdf', 'docx', 'txt', 'html']
    case 'comic':
      return ['original', 'epub', 'pdf', 'html']
    default:
      return []
  }
}

/** whether `format` is the book's own file, saved as it is */
export const isOwnFormat = (b: Pick<BookRecord, 'kind' | 'fileName'>, format: BookFormat | undefined) =>
  !format || format === 'original' || format === sourceFormat(b) || !exportFormats(b).includes(format)

/** the extension the book is saved with in `format` */
export const formatExtension = (b: Pick<BookRecord, 'kind' | 'fileName'>, format: BookFormat) =>
  format === 'original' ? extOf(b.fileName) : format

export class ExportError extends Error {}

// ---------- reading an EPUB ----------

const attr = (tag: string, name: string) => new RegExp(String.raw`\s${name}\s*=\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]

/** `rel` (a link inside the file at `from`) as a path from the zip's root */
function resolvePath(from: string, rel: string): string {
  if (/^(blob|data|https?):/i.test(rel)) return rel
  if (/^(blob|data|https?):/i.test(from)) {
    try {
      return new URL(rel, from).href
    } catch {
      return rel // a blob or data URL has no folder to be relative to
    }
  }
  const parts = from.split('/').slice(0, -1)
  for (const seg of decodeURIComponent(rel.split('#')[0]!.split('?')[0]!).split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

const HEADING = /^h([1-6])$/
// elements whose text runs on inside the paragraph around them
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd', 'label', 'mark',
  'q', 'rb', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr',
])
const SKIP = new Set(['script', 'style', 'head', 'title', 'noscript', 'template'])

/** an (X)HTML section as headings, paragraphs and images, in order */
export function sectionBlocks(html: string, path: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: Block[] = []
  let text = ''
  let level = 0
  const flush = () => {
    const s = text.replace(/\s+/g, ' ').trim()
    text = ''
    if (!s) return
    out.push(level ? { t: 'h', level, text: s } : { t: 'p', text: s })
  }
  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        text += child.nodeValue ?? ''
        continue
      }
      if (child.nodeType !== 1) continue
      const el = child as Element
      const tag = el.localName.toLowerCase()
      if (SKIP.has(tag)) continue
      if (tag === 'img' || tag === 'image') {
        const src = el.getAttribute('src') ?? el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
        if (!src || /^https?:/i.test(src)) continue
        flush()
        out.push({ t: 'img', src: resolvePath(path, src), alt: el.getAttribute('alt') ?? '' })
        continue
      }
      if (tag === 'br') {
        flush()
        continue
      }
      if (INLINE.has(tag)) {
        walk(el)
        continue
      }
      // a block: ends the paragraph before it and its own
      flush()
      const h = HEADING.exec(tag)
      const outer = level
      if (h) level = Number(h[1])
      walk(el)
      flush()
      level = outer
    }
  }
  if (doc.body) walk(doc.body)
  flush()
  return out
}

const RTL_LETTERS = /[\u0590-\u05FF\u0600-\u06FF\uFB1D-\uFDFF]/g
const LTR_LETTERS = /[A-Za-z\u00C0-\u024F\u0400-\u04FF]/g

const isRtlText = (sample: string) => (sample.match(RTL_LETTERS)?.length ?? 0) > (sample.match(LTR_LETTERS)?.length ?? 0)

/** An EPUB's sections, in reading order, as plain blocks, and the images they show. */
export async function readEpub(file: Blob, signal?: AbortSignal): Promise<Omit<BookContent, 'title' | 'author'>> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  const container = (await zip.file('META-INF/container.xml')?.async('string')) ?? ''
  const root = /<rootfile\s[^>]*>/i.exec(container)?.[0]
  const opfPath = root && attr(root, 'full-path')
  const opf = opfPath ? await zip.file(opfPath)?.async('string') : undefined
  if (!opfPath || !opf) throw new ExportError('epub')
  const items = new Map<string, { href: string; type: string }>()
  for (const item of opf.match(/<item\b[^>]*>/gi) ?? []) {
    const id = attr(item, 'id')
    const href = attr(item, 'href')
    if (id && href) items.set(id, { href: resolvePath(opfPath, href), type: attr(item, 'media-type') ?? '' })
  }
  const spine = (opf.match(/<itemref\b[^>]*>/gi) ?? [])
    .map((r) => items.get(attr(r, 'idref') ?? ''))
    .filter((it): it is { href: string; type: string } => !!it && /html/i.test(it.type || 'html'))
  const sections: Block[][] = []
  const images = new Map<string, Blob>()
  let sample = ''
  for (const [i, it] of spine.entries()) {
    if (i % 10 === 9) await tick()
    signal?.throwIfAborted()
    const html = await zip.file(it.href)?.async('string')
    if (!html) continue
    const blocks = sectionBlocks(html, it.href)
    for (const b of blocks) {
      if (b.t !== 'img') {
        if (sample.length < 20000) sample += b.text
      } else if (!images.has(b.src)) {
        const img = zip.file(b.src)
        if (img) images.set(b.src, await img.async('blob'))
      }
    }
    const kept = blocks.filter((b) => b.t !== 'img' || images.has(b.src))
    if (kept.length) sections.push(kept)
  }
  if (!sections.length) throw new ExportError('empty')
  return { rtl: isRtlText(sample), sections, images }
}

/** A MOBI/AZW, FB2 or comic, read through foliate-js: each section as the reader itself loads it (its images then have
 *  blob URLs of their own), as plain blocks. */
async function readOther(file: Blob, signal?: AbortSignal): Promise<Omit<BookContent, 'title' | 'author'>> {
  const { makeBook } = await import('foliate-js/view.js')
  const book = await makeBook(file)
  const sections: Block[][] = []
  const images = new Map<string, Blob>()
  let sample = ''
  try {
    for (const [i, sec] of (book.sections ?? []).entries()) {
      if (i % 10 === 9) await tick()
      signal?.throwIfAborted()
      if (sec.linear === 'no' || !sec.load) continue
      try {
        const url = await sec.load()
        if (!url) continue
        const blocks = sectionBlocks(await (await fetch(url)).text(), url)
        for (const b of blocks) {
          if (b.t !== 'img') {
            if (sample.length < 20000) sample += b.text
          } else if (!images.has(b.src)) {
            const img = await fetch(b.src).then((r) => (r.ok ? r.blob() : undefined), () => undefined)
            if (img) images.set(b.src, img)
          }
        }
        const kept = blocks.filter((b) => b.t !== 'img' || images.has(b.src))
        if (kept.length) sections.push(kept)
      } finally {
        sec.unload?.()
      }
    }
  } finally {
    book.destroy?.()
  }
  if (!sections.length) throw new ExportError('empty')
  return { rtl: isRtlText(sample), sections, images }
}

// ---------- writing ----------

// characters that are illegal in XML 1.0
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
const esc = (s: string) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** plain text: a blank line between paragraphs, two around headings, a row of stars between sections */
function buildTxt(c: BookContent): Blob {
  const parts = c.sections.map((s) =>
    s
      .filter((b) => b.t !== 'img')
      .map((b) => (b.t === 'h' ? `\n${b.text}\n` : b.text))
      .join('\n\n')
      .trim(),
  )
  // a BOM, so Windows' Notepad and older editors read the Hebrew as UTF-8
  return new Blob(['\uFEFF' + parts.filter(Boolean).join('\n\n* * *\n\n') + '\n'], { type: 'text/plain;charset=utf-8' })
}

const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }

const dataUrl = (blob: Blob, path: string) =>
  new Promise<string>((resolve, reject) => {
    const typed = blob.type ? blob : new Blob([blob], { type: IMAGE_TYPES[extOf(path)] ?? 'application/octet-stream' })
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(typed)
  })

/** one web page holding the whole book, its images inside it */
async function buildHtml(c: BookContent): Promise<Blob> {
  const urls = new Map<string, string>()
  for (const [path, blob] of c.images) urls.set(path, await dataUrl(blob, path))
  const dir = c.rtl ? 'rtl' : 'ltr'
  const lang = c.rtl ? 'he' : 'en'
  const body = c.sections
    .map(
      (s) =>
        '<section>\n' +
        s
          .map((b) => {
            if (b.t === 'h') return `<h${b.level}>${esc(b.text)}</h${b.level}>`
            if (b.t === 'p') return `<p>${esc(b.text)}</p>`
            const url = urls.get(b.src)
            return url ? `<figure><img src="${url}" alt="${esc(b.alt)}"/></figure>` : ''
          })
          .filter(Boolean)
          .join('\n') +
        '\n</section>',
    )
    .join('\n')
  const head = esc(c.title) + (c.author ? ` — ${esc(c.author)}` : '')
  const html = `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${head}</title>
${c.author ? `<meta name="author" content="${esc(c.author)}"/>\n` : ''}<style>
body { max-width: 42em; margin: 0 auto; padding: 1.5em; font-family: "David", "Frank Ruehl CLM", Georgia, serif; font-size: 1.15em; line-height: 1.7; }
section + section { margin-top: 3em; padding-top: 2em; border-top: 1px solid #ccc; break-before: page; }
p { margin: 0 0 0.8em; }
figure { margin: 1em 0; text-align: center; }
figure img { max-width: 100%; height: auto; }
@media (prefers-color-scheme: dark) { body { background: #1c1c1e; color: #e8e6e3; } section + section { border-color: #444; } }
</style>
</head>
<body>
${body}
</body>
</html>
`
  return new Blob([html], { type: 'text/html;charset=utf-8' })
}

const W = ['http:', '', 'schemas.openxmlformats.org', 'wordprocessingml/2006/main'].join('/')
const R_NS = ['http:', '', 'schemas.openxmlformats.org', 'officeDocument/2006/relationships'].join('/')
const PKG = ['http:', '', 'schemas.openxmlformats.org', 'package/2006'].join('/')

/** a Word document: the book's headings as Word headings, each section starting a new page. Images are left out. */
async function buildDocx(c: BookContent, signal?: AbortSignal): Promise<Blob> {
  const bidi = c.rtl ? '<w:bidi/>' : ''
  const rtl = c.rtl ? '<w:rtl/>' : ''
  const para = (text: string, style?: string) =>
    `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${bidi}</w:pPr><w:r><w:rPr>${rtl}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
  const body: string[] = []
  for (const [i, s] of c.sections.entries()) {
    if (i % 25 === 24) {
      await tick()
      signal?.throwIfAborted()
    }
    const text = s.filter((b) => b.t !== 'img')
    if (!text.length) continue
    if (body.length) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    for (const b of text) body.push(b.t === 'h' ? para(b.text, `Heading${Math.min(b.level, 3)}`) : para(b.text))
  }
  const lang = c.rtl ? 'he-IL' : 'en-US'
  const heading = (n: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="David"/><w:sz w:val="24"/><w:szCs w:val="26"/><w:lang w:val="en-US" w:bidi="${c.rtl ? 'he-IL' : 'en-US'}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>${c.rtl ? '<w:pPr><w:bidi/><w:jc w:val="both"/></w:pPr><w:rPr><w:rtl/></w:rPr>' : '<w:pPr><w:jc w:val="both"/></w:pPr>'}</w:style>
${heading(1, 36)}
${heading(2, 30)}
${heading(3, 26)}
</w:styles>`
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R_NS}"><w:body>
${body.join('\n')}
<w:sectPr>${bidi ? '<w:bidi/>' : ''}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="${PKG}/metadata/core-properties" xmlns:dc="${['http:', '', 'purl.org', 'dc/elements/1.1/'].join('/')}" xmlns:dcterms="${['http:', '', 'purl.org', 'dc/terms/'].join('/')}" xmlns:xsi="${['http:', '', 'www.w3.org', '2001/XMLSchema-instance'].join('/')}">
<dc:title>${esc(c.title)}</dc:title>${c.author ? `<dc:creator>${esc(c.author)}</dc:creator>` : ''}<dc:language>${lang}</dc:language>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="${PKG}/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/></Relationships>`,
  )
  zip.file('word/document.xml', doc)
  zip.file('word/styles.xml', styles)
  zip.file('docProps/core.xml', core)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

const NS = (host: string, path: string) => ['http:', '', host, path].join('/')

/** an EPUB 3 of the book: a section per file, its headings as the table of contents, its images and its cover inside */
async function buildEpubOut(c: BookContent, cover?: Blob, signal?: AbortSignal): Promise<Blob> {
  const lang = c.rtl ? 'he' : 'en'
  const dir = c.rtl ? 'rtl' : 'ltr'
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  )
  zip.file('OEBPS/style.css', 'p { margin: 0 0 .8em; }\nfigure { margin: 1em 0; text-align: center; }\nfigure img { max-width: 100%; max-height: 95vh; }\n')
  const manifest: string[] = []
  const names = new Map<string, string>()
  for (const [i, [path, blob]] of [...c.images].entries()) {
    const ext = IMAGE_TYPES[extOf(path)] ? extOf(path) : blob.type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'jpg'
    const name = `img/i${i}.${ext}`
    names.set(path, name)
    zip.file(`OEBPS/${name}`, blob)
    manifest.push(`<item id="i${i}" href="${name}" media-type="${IMAGE_TYPES[ext] ?? 'image/jpeg'}"/>`)
  }
  if (cover) {
    zip.file('OEBPS/cover.jpg', cover)
    manifest.push('<item id="cover-image" href="cover.jpg" media-type="' + (cover.type || 'image/jpeg') + '" properties="cover-image"/>')
  }
  const toc: { file: string; label: string }[] = []
  for (const [i, sec] of c.sections.entries()) {
    if (i % 25 === 24) {
      await tick()
      signal?.throwIfAborted()
    }
    const file = `s${i}.xhtml`
    const body = sec
      .map((b) => {
        if (b.t === 'h') return `<h${b.level}>${esc(b.text)}</h${b.level}>`
        if (b.t === 'p') return `<p>${esc(b.text)}</p>`
        const name = names.get(b.src)
        return name ? `<figure><img src="${name}" alt="${esc(b.alt)}"/></figure>` : ''
      })
      .filter(Boolean)
      .join('\n')
    const head = sec.find((b) => b.t === 'h')
    const label = head && head.t === 'h' ? head.text : `${i + 1}`
    toc.push({ file, label })
    zip.file(
      `OEBPS/${file}`,
      `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${NS('www.w3.org', '1999/xhtml')}" xml:lang="${lang}" lang="${lang}" dir="${dir}"><head><meta charset="utf-8"/><title>${esc(label)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>\n${body}\n</body></html>`,
    )
    manifest.push(`<item id="s${i}" href="${file}" media-type="application/xhtml+xml"/>`)
  }
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${NS('www.w3.org', '1999/xhtml')}" xmlns:epub="${NS('www.idpf.org', '2007/ops')}" xml:lang="${lang}" lang="${lang}" dir="${dir}"><head><meta charset="utf-8"/><title>${esc(c.title)}</title></head><body><nav epub:type="toc" id="toc"><ol>\n${toc.map((t) => `<li><a href="${t.file}">${esc(t.label)}</a></li>`).join('\n')}\n</ol></nav></body></html>`,
  )
  const id = `urn:uuid:${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16)}`
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="${NS('www.idpf.org', '2007/opf')}" version="3.0" unique-identifier="bookid" xml:lang="${lang}">\n<metadata xmlns:dc="${NS('purl.org', 'dc/elements/1.1/')}"><dc:identifier id="bookid">${id}</dc:identifier><dc:title>${esc(c.title)}</dc:title><dc:language>${lang}</dc:language>${c.author ? `<dc:creator>${esc(c.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${modified}</meta>${cover ? '<meta name="cover" content="cover-image"/>' : ''}</metadata>\n<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest.join('')}</manifest>\n<spine page-progression-direction="${dir}">${c.sections.map((_, i) => `<itemref idref="s${i}"/>`).join('')}</spine>\n</package>`,
  )
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' })
}

// ---------- a book in another format ----------

/** a PDF kept as it is, converted to an EPUB the way an import converts one; a scan or a PDF of tables has no text to give */
async function pdfAsEpub(rec: BookRecord, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<Blob> {
  const [{ extractPdf }, { buildEpub }] = await Promise.all([import('./pdfToBook'), import('./pdfToEpub')])
  const x = await extractPdf(rec.file, rec.fileName, onProgress, signal)
  if (x.keepOriginal || !x.chapters.length) throw new ExportError('noText')
  return buildEpub({ ...x, title: rec.title || x.title, author: rec.author || x.author, cover: rec.cover ?? x.cover }, signal)
}

/** what a long conversion is busy with: the pages of a PDF being read, or the sections of a PDF being laid out */
export type ExportStage = 'pages' | 'sections'

/** The book's file in `format`: its own file when that is the format it is kept in. `onProgress` tells how far a long
 *  step is. Throws an ExportError ('noText', 'empty', 'epub', 'script') when the book cannot be converted. */
export async function exportBook(
  rec: BookRecord,
  format: BookFormat,
  onProgress?: (stage: ExportStage, done: number, total: number) => void,
  signal?: AbortSignal,
  pdf?: PdfOptions,
): Promise<Blob> {
  if (isOwnFormat(rec, format)) return rec.file
  const src = sourceFormat(rec)
  // a PDF kept as it is goes through an EPUB, like on import; an EPUB is read as it is
  const epub = src === 'pdf' ? await pdfAsEpub(rec, (d, t) => onProgress?.('pages', d, t), signal) : src === 'epub' ? rec.file : undefined
  if (format === 'epub' && epub) return epub
  signal?.throwIfAborted()
  const read = epub ? await readEpub(epub, signal) : await readOther(rec.file, signal)
  const content: BookContent = { title: rec.title, author: rec.author, ...read }
  signal?.throwIfAborted()
  if (format === 'epub') return buildEpubOut(content, rec.cover, signal)
  if (format === 'txt') return buildTxt(content)
  if (format === 'html') return buildHtml(content)
  if (format === 'pdf') {
    const { buildPdf, PdfScriptError } = await import('./pdfExport')
    try {
      return await buildPdf(content, rec.cover, (d, t) => onProgress?.('sections', d, t), signal, pdf)
    } catch (e) {
      if (e instanceof PdfScriptError) throw new ExportError('script')
      throw e
    }
  }
  return buildDocx(content, signal)
}
