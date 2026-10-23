import type { FoliateView } from 'foliate-js/view.js'
import { isFixedLayout } from './foliateFixes'

/** how far a page can be enlarged beyond the size that fits the screen */
export const MAX_ZOOM = 5
/** one press of the + / − button */
export const ZOOM_STEP = 1.25

/** the scale at which the page fits the screen, measured the first time the page is zoomed */
const fits = new WeakMap<FoliateView, number>()

/** current display scale of the page on screen (1 = the page's own size) */
function pageScale(view: FoliateView): number {
  // the renderer lists the iframe of every slot of the spread, the empty one of a single page included
  for (const { doc } of view.renderer.getContents?.() ?? []) {
    const frame = doc?.defaultView?.frameElement as HTMLElement | null
    if (!doc || !frame || !frame.offsetWidth) continue
    // a PDF page is a canvas drawn at scale × the device's pixel ratio, with the scale kept in a CSS variable
    const drawn = parseFloat(doc.documentElement.style.getPropertyValue('--scale-factor'))
    if (drawn > 0) return drawn / devicePixelRatio
    // a fixed-layout EPUB page is the same document scaled with a CSS transform
    return frame.getBoundingClientRect().width / frame.offsetWidth
  }
  return 1
}

/** is the book a page-by-page one that can be zoomed (a PDF shown as is, a fixed-layout EPUB); the view has no book until it has opened it */
export const canZoom = (view: FoliateView | null): view is FoliateView => !!view && !!(view.book as FoliateView["book"] | undefined) && isFixedLayout(view)

/** how much the page is enlarged compared to the whole page on screen: 1 = fit, 2 = twice as big */
export function zoomLevel(view: FoliateView): number {
  const fit = fits.get(view)
  return fit ? pageScale(view) / fit : 1
}

/** the page scale for a zoom level, measuring the fit scale first when the page still fits */
function remember(view: FoliateView) {
  if (!fits.has(view) || view.renderer.getAttribute('zoom') === 'fit-page') fits.set(view, pageScale(view))
}

/**
 * Show the page `level` times bigger than the whole page on screen (1 = whole page). The page then scrolls
 * inside the view. `anchor`, in the view's own coordinates, is the point that keeps its place under the fingers.
 */
export function setZoom(view: FoliateView, level: number, anchor?: { x: number; y: number }) {
  const r = view.renderer
  remember(view)
  const fit = fits.get(view) ?? 1
  const before = pageScale(view)
  const next = Math.min(Math.max(level, 1), MAX_ZOOM)
  if (next === 1) r.setAttribute('zoom', 'fit-page')
  else r.setAttribute('zoom', String(fit * next))
  // a page that is bigger than the view must not be centred past its left and top edges, where it could never be scrolled to
  r.style.justifyContent = 'safe center'
  r.style.alignItems = 'safe center'
  const ratio = pageScale(view) / before
  if (!anchor || !Number.isFinite(ratio)) return
  r.scrollLeft = (r.scrollLeft + anchor.x) * ratio - anchor.x
  r.scrollTop = (r.scrollTop + anchor.y) * ratio - anchor.y
}

/** the page's own scroll, back to its top left corner (a new page opens at its start) */
export function resetPageScroll(view: FoliateView) {
  view.renderer.scrollTo(0, 0)
}
