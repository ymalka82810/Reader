import { useEffect, useState, type RefObject } from 'react'
import type { FoliateView } from 'foliate-js/view.js'
import { canZoom, setZoom, zoomLevel, ZOOM_STEP } from '../../lib/pdfZoom'
import { t } from '../../i18n'
import './viewModes.css'

/** zoom of a page-by-page book (a PDF shown as is): the same as pinching, for a screen without two fingers. Nothing for other books. */
export function ZoomSection({ viewRef }: { viewRef: RefObject<FoliateView | null> }) {
  const [view, setView] = useState<FoliateView | null>(null)
  const [level, setLevel] = useState(1)
  useEffect(() => {
    const v = viewRef.current
    if (!canZoom(v)) return
    setView(v)
    setLevel(zoomLevel(v))
  }, [viewRef])
  if (!view) return null
  const apply = (next: number) => {
    // keep the middle of the screen in place
    const { width, height } = view.renderer.getBoundingClientRect()
    setZoom(view, next, { x: width / 2, y: height / 2 })
    setLevel(zoomLevel(view))
  }
  return (
    <fieldset className="view-modes">
      <legend>{t('reader.zoom')}</legend>
      <div className="mode-row">
        <div className="seg" role="group" aria-label={t('reader.zoom')}>
          <button aria-label={t('reader.zoomOut')} title={t('reader.zoomOut')} onClick={() => apply(level / ZOOM_STEP)}>−</button>
          <button aria-label={t('reader.zoomFit')} title={t('reader.zoomFit')} onClick={() => apply(1)}>
            {Math.round(level * 100)}%
          </button>
          <button aria-label={t('reader.zoomIn')} title={t('reader.zoomIn')} onClick={() => apply(level * ZOOM_STEP)}>+</button>
        </div>
        <small className="muted">{t('reader.zoomHint')}</small>
      </div>
    </fieldset>
  )
}
