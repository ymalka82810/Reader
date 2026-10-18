// Interactive (scripted) EPUBs run in a sandboxed iframe, see interactive.html. Everything that crosses the
// boundary is defined and checked here: the book's scripts can only send the few messages below.

/** what the sandbox page tells the reader */
export type SandboxEvent =
  | { type: 'shell-ready' }
  | { type: 'ready' }
  | { type: 'link'; href: string }

/** what the reader tells the sandbox page */
export type SandboxCommand = { source: 'reader'; type: 'load'; html: string }

/** limit on a link target coming from the book, so a script cannot flood the reader */
const MAX_HREF = 2048

/** The message is from a book page: shape-checked, because the book's scripts can post anything. */
export function parseSandboxMessage(d: unknown): SandboxEvent | null {
  if (!d || typeof d !== 'object') return null
  const m = d as { source?: unknown; type?: unknown; href?: unknown }
  if (m.source !== 'reader-sandbox') return null
  if (m.type === 'shell-ready' || m.type === 'ready') return { type: m.type }
  if (m.type === 'link' && typeof m.href === 'string' && m.href.length <= MAX_HREF) return { type: 'link', href: m.href }
  return null
}

/** an EPUB 3 manifest item as foliate-js reads it from the OPF */
interface ManifestItem {
  properties?: string[]
  mediaType?: string
}

/** The book declares scripts (`properties="scripted"` on a content document, or a script file in the manifest). */
export const isScriptedBook = (book: { resources?: { manifest?: ManifestItem[] } }): boolean =>
  !!book.resources?.manifest?.some((i) => i.properties?.includes('scripted') || /\/(x-)?(javascript|ecmascript)/.test(i.mediaType ?? ''))

/** Where a book's link leads: another chapter of the book, a page on the web, or nowhere that is allowed. */
export function classifyLink(href: string): 'web' | 'book' | 'blocked' {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase()
  if (!scheme) return 'book'
  return scheme === 'http' || scheme === 'https' ? 'web' : 'blocked'
}

const BLOB_URL = /blob:[^\s"'()<>]+/g
const readAsDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

/**
 * Turns a chapter document (XHTML or HTML text, resources already replaced by blob: URLs of this page) into
 * the HTML text the sandbox page writes. A sandboxed page with an opaque origin cannot open this page's blob:
 * URLs, so every resource is inlined: scripts and stylesheets as text, the rest as data: URLs. Parsing here
 * keeps scripts from running in the reader's own page, and serialising as HTML makes XHTML-only syntax
 * (self-closing script tags) safe for the HTML parser of the sandbox.
 */
export async function toSandboxHtml(
  text: string,
  mediaType: string,
  readBlob: (url: string) => Promise<Blob> = (url) => fetch(url).then((r) => r.blob()),
): Promise<string> {
  const type = mediaType === 'text/html' ? 'text/html' : 'application/xhtml+xml'
  let doc = new DOMParser().parseFromString(text, type)
  if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(text, 'text/html')
  if (doc.contentType !== 'text/html') {
    // an XML document serialises as XML (escaping < and & inside scripts); move the tree to an HTML document
    const html = document.implementation.createHTMLDocument('')
    html.replaceChild(html.importNode(doc.documentElement, true), html.documentElement)
    doc = html
  }

  const dataUrls = new Map<string, Promise<string>>()
  const dataUrl = (url: string) => {
    let p = dataUrls.get(url)
    if (!p) dataUrls.set(url, (p = readBlob(url).then(async (b) => (b.type.includes('css') ? url : readAsDataUrl(b))).catch(() => '')))
    return p
  }
  const replaceAsync = async (str: string, fn: (url: string) => Promise<string>) => {
    const urls = [...new Set(str.match(BLOB_URL) ?? [])]
    const done = new Map(await Promise.all(urls.map(async (u) => [u, await fn(u)] as const)))
    return str.replace(BLOB_URL, (u) => done.get(u) ?? u)
  }
  /** CSS text with every blob: URL (fonts, images, @import) inlined, stylesheets recursively */
  const inlineCss = async (css: string, depth = 0): Promise<string> =>
    replaceAsync(css, async (u) => {
      const b = await readBlob(u).catch(() => null)
      if (!b) return ''
      if (b.type.includes('css') && depth < 4) return 'data:text/css;base64,' + btoa(unescape(encodeURIComponent(await inlineCss(await b.text(), depth + 1))))
      return readAsDataUrl(b)
    })

  for (const el of doc.querySelectorAll('script[src^="blob:"]')) {
    const b = await readBlob(el.getAttribute('src') ?? '').catch(() => null)
    el.removeAttribute('src')
    el.textContent = b ? (await b.text()).replace(/<\/(script)/gi, '<\\/$1') : ''
  }
  for (const el of doc.querySelectorAll('link[href^="blob:"]')) {
    const b = await readBlob(el.getAttribute('href') ?? '').catch(() => null)
    if (b && el.getAttribute('rel')?.toLowerCase().includes('stylesheet')) {
      const style = doc.createElement('style')
      style.textContent = await inlineCss(await b.text())
      el.replaceWith(style)
    } else el.remove()
  }
  for (const el of doc.querySelectorAll('style')) el.textContent = await inlineCss(el.textContent ?? '')
  for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', await inlineCss(el.getAttribute('style') ?? ''))
  for (const el of doc.querySelectorAll('*'))
    for (const attr of el.getAttributeNames()) {
      const v = el.getAttribute(attr) ?? ''
      if (v.includes('blob:')) el.setAttribute(attr, await replaceAsync(v, dataUrl))
    }
  return '<!doctype html>' + doc.documentElement.outerHTML
}
