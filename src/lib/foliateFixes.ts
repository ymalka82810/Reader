import type { FoliateView } from 'foliate-js/view.js'

const RTL_LANGS = new Set(['he', 'iw', 'yi', 'ar', 'fa', 'ur', 'ps', 'dv', 'ckb', 'sd', 'ug'])
const RTL_SCRIPT = /[\p{Script=Hebrew}\p{Script=Arabic}]/u

/**
 * foliate takes the page direction only from the EPUB's page-progression-direction, which many
 * Hebrew/Arabic books leave out. Without it goLeft/goRight treat the book as left-to-right, so a
 * tap on the left edge goes back instead of forward. Fill it in from the language (or the title).
 */
export function fixBookDir(view: FoliateView, lang: string, title: string) {
  if (view.book.dir) return
  if (RTL_LANGS.has(lang) || (!lang && RTL_SCRIPT.test(title))) view.book.dir = 'rtl'
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
