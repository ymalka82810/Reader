import { useCallback, useRef, useState, type RefObject } from 'react'
import type { FoliateRelocateDetail, FoliateView } from 'foliate-js/view.js'
import { linearSizes } from '../lib/pace'

export type PageEstimate = { current: number; total: number; approx: boolean }

/**
 * Estimated page number and count for the open book. Page size is calibrated from the sections laid out so far
 * (bytes of source per rendered page), so the total sharpens as the reader moves through the book.
 */
export function usePageEstimate(viewRef: RefObject<FoliateView | null>) {
  const [pages, setPages] = useState<PageEstimate | null>(null)
  const calib = useRef(new Map<number, { pages: number; size: number }>())
  /** the last relocate event, for recomputing after a re-layout and for other consumers of the position */
  const lastDetail = useRef<FoliateRelocateDetail | null>(null)

  const recompute = useCallback(
    (detail?: FoliateRelocateDetail) => {
      const view = viewRef.current
      const r = view?.renderer
      const d = detail ?? lastDetail.current
      if (!r || !d?.section || typeof r.pages !== 'number') return
      const sections = view.book.sections
      const sizes = linearSizes(sections)
      const idx: number = d.section.current
      const secSize = sizes[idx] ?? 0
      const scrolled: boolean = r.scrolled
      const contentPages = scrolled ? r.pages : r.pages - 2
      if (contentPages < 1 || !r.size) return
      const curInSection = scrolled
        ? Math.min(contentPages, Math.round(r.start / r.size) + 1)
        : Math.min(contentPages, Math.max(1, r.page))

      if (secSize > 3000) calib.current.set(idx, { pages: contentPages, size: secSize })
      let sumSize = 0
      let sumPages = 0
      calib.current.forEach((c) => {
        sumSize += c.size
        sumPages += c.pages
      })
      const bytesPerPage = sumPages > 0 ? sumSize / sumPages : secSize / contentPages || 2000
      const totalSize = sizes.reduce((a, b) => a + b, 0)
      const before = sizes.slice(0, idx).reduce((a, b) => a + b, 0)
      const total = Math.max(1, Math.round(totalSize / bytesPerPage))
      const current = Math.min(total, Math.round(before / bytesPerPage) + curInSection)
      // the total is an estimate until every section with text has been laid out
      const approx = sizes.some((sz, i) => sz > 0 && !calib.current.has(i))
      setPages({ current, total, approx })
    },
    [viewRef],
  )

  /** the layout changed: page size must be re-measured */
  const resetCalibration = useCallback(() => calib.current.clear(), [])

  return { pages, recompute, resetCalibration, lastDetail }
}
