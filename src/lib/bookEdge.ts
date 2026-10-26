import type { FoliateView } from 'foliate-js/view.js'

/** which way a tap on the left/right edge (or an arrow key) turns the page: 1 = forward, -1 = back */
export const turnDirection = (view: Pick<FoliateView, 'book'>, side: 'left' | 'right'): 1 | -1 => {
  const rtl = view.book.dir === 'rtl'
  return (side === 'left') === rtl ? 1 : -1
}

/**
 * True when turning the page in this direction has nowhere to go: back on the first page of the book,
 * or forward on its last page. The toolbars are then shown instead of hidden, so the reader sees that
 * the turn did nothing rather than a tap that seems to vanish.
 */
export function atBookEdge(view: FoliateView | null, dir: 1 | -1, fraction: number): boolean {
  const r = view?.renderer
  if (!r) return false
  if (r.scrolled) return dir === 1 ? r.viewSize - r.end <= 2 && fraction >= 0.995 : r.start <= 2 && fraction <= 0.005
  const flag = dir === 1 ? r.atEnd : r.atStart
  if (typeof flag === 'boolean') return flag
  // the fixed-layout renderer (PDF shown as is) has no edge flags: fall back to the book position
  return dir === 1 ? fraction >= 0.999 : fraction <= 0.001
}
