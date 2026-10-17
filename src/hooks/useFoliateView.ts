import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import 'foliate-js/view.js'
import type { FoliateRelocateDetail, FoliateView } from 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { flattenToc, type FlatTocItem } from '../components/reader/toc'
import { getBook } from '../lib/db'
import { alignDocDir, fixBookDir, guardBookEdges } from '../lib/foliateFixes'
import { bookFromSections } from '../lib/pdfToBook'
import { bookCSS, type Settings } from '../lib/settings'
import { useLatest } from './useLatest'

export interface FoliateHandlers {
  /** runs once the book is found and before it is shown: await anything the first page needs */
  prepare: () => Promise<void>
  /** a section's document loaded into its iframe */
  load: (d: { doc: Document; index: number }) => void
  /** a fresh overlay was created for a section: draw its highlights */
  createOverlay: (view: FoliateView) => void
  /** an existing highlight was tapped */
  showAnnotation: (cfi: string) => void
  relocate: (d: FoliateRelocateDetail) => void
}

function applySettings(view: FoliateView, s: Settings) {
  const r = view.renderer
  r.setAttribute?.('flow', s.flow)
  if (s.pageTransition) r.setAttribute?.('animated', '')
  else r.removeAttribute?.('animated')
  r.setStyles?.(bookCSS(s))
}

/**
 * Opens book `id` in a foliate view inside `host` (and in `viewRef` once it is open), applies the display
 * settings to it (also as they change) and forwards its events to `handlers`. Re-opens only when `id` changes:
 * settings and handlers are read through refs, so their latest values are used without tearing the view down.
 */
export function useFoliateView(
  id: string,
  host: RefObject<HTMLDivElement | null>,
  viewRef: MutableRefObject<FoliateView | null>,
  settings: Settings,
  handlers: FoliateHandlers,
) {
  const settingsRef = useLatest(settings)
  const h = useLatest(handlers)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [dir, setDir] = useState<'rtl' | 'ltr'>('rtl')
  const [toc, setToc] = useState<FlatTocItem[]>([])
  /** primary language subtag of the open book ("he", "en", …), '' when unknown */
  const bookLang = useRef('')

  useEffect(() => {
    let cancelled = false
    const view = document.createElement('foliate-view') as FoliateView
    view.style.cssText = 'display:block;width:100%;height:100%'
    const syncDir = () => setDir(view.book.dir === 'ltr' ? 'ltr' : 'rtl')

    ;(async () => {
      try {
        const rec = await getBook(id)
        if (!rec) throw new Error('הספר לא נמצא בספרייה')
        await h.current.prepare()
        if (cancelled) return
        host.current?.append(view)

        const source =
          rec.kind === 'pdf' && rec.pdf
            ? bookFromSections({ title: rec.title, author: rec.author, ...rec.pdf })
            : rec.file
        await view.open(source)
        if (cancelled) return
        viewRef.current = view

        view.renderer.setAttribute?.('gap', '5%')
        applySettings(view, settingsRef.current)

        setTitle(rec.title)
        const lang = [view.book.metadata?.language].flat()[0]
        bookLang.current = typeof lang === 'string' ? (lang.split(/[-_]/)[0] ?? '').toLowerCase() : ''
        fixBookDir(view, bookLang.current, rec.title)
        guardBookEdges(view)
        syncDir()
        setToc(flattenToc(view.book.toc))

        const on = <T,>(type: string, fn: (detail: T) => void) =>
          view.addEventListener(type, (e) => fn((e as CustomEvent<T>).detail))
        on<{ doc: Document; index: number }>('load', (d) => {
          alignDocDir(view, d.doc)
          syncDir()
          h.current.load(d)
        })
        on<{ draw: (fn: typeof Overlayer.highlight, opts: object) => void; annotation: { color: string } }>(
          'draw-annotation',
          ({ draw, annotation }) => draw(Overlayer.highlight, { color: annotation.color }),
        )
        on('create-overlay', () => h.current.createOverlay(view))
        on<{ value: string }>('show-annotation', (d) => h.current.showAnnotation(d.value))
        on<FoliateRelocateDetail>('relocate', (d) => h.current.relocate(d))

        await view.init({ lastLocation: rec.cfi, showTextStart: !rec.cfi })
        setStatus('ready')
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      try {
        view.close?.()
      } catch {
        /* view may already be closed or half-initialised; teardown continues with remove() */
      }
      view.remove()
      viewRef.current = null
    }
  }, [id, host, viewRef, h, settingsRef])

  // apply settings changes live
  useEffect(() => {
    if (viewRef.current) applySettings(viewRef.current, settings)
  }, [viewRef, settings])

  return { status, error, title, dir, toc, bookLang }
}
