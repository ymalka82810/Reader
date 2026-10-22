import type { FoliateView } from 'foliate-js/view.js'

const RTL_LANGS = new Set(['he', 'iw', 'yi', 'ar', 'fa', 'ur', 'ps', 'dv', 'ckb', 'sd', 'ug', 'heb', 'ara', 'fas', 'per', 'urd'])
const RTL_SCRIPT = /[\p{Script=Hebrew}\p{Script=Arabic}]/u

/** PDF shown page by page, or a pre-paginated EPUB: every page is a picture laid out at fixed coordinates */
const isFixedLayout = (view: FoliateView) => view.book.rendition?.layout === 'pre-paginated'

/**
 * foliate takes the page direction only from the EPUB's page-progression-direction, which many
 * Hebrew/Arabic books leave out. Without it goLeft/goRight treat the book as left-to-right, so a
 * tap on the left edge goes back instead of forward. Fill it in from the language (or the title).
 */
export function fixBookDir(view: FoliateView, lang: string, title: string) {
  if (view.book.dir) return
  if (!(RTL_LANGS.has(lang) || (!lang && RTL_SCRIPT.test(title)))) return
  view.book.dir = 'rtl'
  // a fixed-layout renderer (PDF shown as is, pre-paginated EPUB) pairs its pages into spreads in open(), which
  // already ran with no direction: pair them again right-to-left, so a tablet spread puts the earlier page on the right
  if (isFixedLayout(view)) view.renderer.open?.(view.book)
}

/**
 * The paginator lays the columns out right-to-left only if the chapter document itself is RTL,
 * independent of book.dir, while the tap zones follow book.dir. Make the two agree, or the pages
 * slide the opposite way from the tap: an RTL book gets an RTL document, and an RTL document
 * makes the book RTL. Runs on foliate's 'load' event, which fires before the paginator reads
 * the direction.
 */
export function alignDocDir(view: FoliateView, doc: Document) {
  // a fixed-layout page is positioned in absolute coordinates (a PDF page is a canvas drawn at the device's pixel
  // ratio and scaled down from the top-left corner): an RTL page would anchor that canvas to the right and show
  // only its right part squeezed into the left of the screen, so its direction is never touched
  if (isFixedLayout(view)) return
  const root = doc.documentElement
  const docRtl =
    root.dir === 'rtl' || doc.body?.dir === 'rtl' || doc.defaultView?.getComputedStyle(doc.body).direction === 'rtl'
  if (docRtl) view.book.dir = 'rtl'
  else if (view.book.dir === 'rtl') root.dir = 'rtl'
}

/** is there a linear section before (-1) / after (1) section `index` */
function hasAdjacent(view: FoliateView, index: number, dir: 1 | -1) {
  const sections = view.book.sections
  for (let i = index + dir; i >= 0 && i < sections.length; i += dir) if (sections[i]?.linear !== 'no') return true
  return false
}

/**
 * In scrolled mode foliate's prev() at the top of the first section (and next() at the bottom of
 * the last) tries to load a section that doesn't exist; the error leaves the renderer locked for
 * good, after which every page turn and every goTo (table of contents, bookmarks, search) is
 * silently ignored. Turn those calls into no-ops before they reach foliate.
 */
export function guardBookEdges(view: FoliateView) {
  const r = view.renderer
  const prev = r.prev.bind(r)
  const next = r.next.bind(r)
  const index = () => r.getContents?.()[0]?.index
  const blocked = (dir: 1 | -1) => {
    if (!r.scrolled) return false
    const i = index()
    if (i === undefined || hasAdjacent(view, i, dir)) return false
    return dir === -1 ? r.start <= 0 : r.viewSize - r.end <= 2
  }
  r.prev = (distance?: number) => (blocked(-1) ? Promise.resolve() : prev(distance))
  r.next = (distance?: number) => (blocked(1) ? Promise.resolve() : next(distance))
}

const OWN_STYLE = 'data-reader-style'

/**
 * foliate puts one <style> first and one last in the head of every section; the app's own CSS (the settings) lives
 * there. Mark them right when the section loads, so they are never mistaken for the book's stylesheets.
 */
export function markOwnStyles(doc: Document) {
  const head = doc.head
  if (!head) return
  for (const el of [head.firstElementChild, head.lastElementChild]) if (el?.localName === 'style') el.setAttribute(OWN_STYLE, '')
}

/** turns the book's own stylesheets (linked or embedded) on or off in a section, leaving the app's styling alone */
export function setBookStyles(doc: Document, on: boolean) {
  for (const el of doc.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel~="stylesheet"], style')) {
    if (!el.hasAttribute(OWN_STYLE)) el.disabled = !on
  }
}
