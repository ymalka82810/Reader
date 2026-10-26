import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import 'foliate-js/view.js'
import type { FoliateRelocateDetail, FoliateView } from 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { flattenToc, type FlatTocItem } from '../components/reader/toc'
import { getBook } from '../lib/db'
import { alignDocDir, firstSectionShowsImage, fixBookDir, guardBookEdges, isFixedLayout, markOwnStyles, setBookStyles, startAtFirstSection } from '../lib/foliateFixes'
import { resetPageScroll } from '../lib/pdfZoom'
import { bookFromSections } from '../lib/pdfToBook'
import { t } from '../i18n'
import { applyLayout, bookCSS, type Settings } from '../lib/settings'
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

function applySettings(view: FoliateView, s: Settings, customFace: string) {
  const r = view.renderer
  r.setAttribute?.('flow', s.flow)
  if (s.pageTransition) r.setAttribute?.('animated', '')
  else r.removeAttribute?.('animated')
  applyLayout(r, s)
  for (const c of r.getContents?.() ?? []) if (c.doc) setBookStyles(c.doc, s.bookStyles)
  r.setStyles?.(bookCSS(s, customFace))
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
  /** @font-face rule of the uploaded font, '' when there is none */
  customFace: string,
  /** opens here instead of at the saved reading position */
  startCfi: string | undefined,
  handlers: FoliateHandlers,
) {
  const settingsRef = useLatest(settings)
  const faceRef = useLatest(customFace)
  const h = useLatest(handlers)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [dir, setDir] = useState<'rtl' | 'ltr'>('rtl')
  const [toc, setToc] = useState<FlatTocItem[]>([])
  /** primary language subtag of the open book ("he", "en", …), '' when unknown */
  const bookLang = useRef('')
  const [lang, setLang] = useState('')
  /** the cover image shown over a book that opens without it (blob URL), '' when there is none */
  const [coverUrl, setCoverUrl] = useState('')

  useEffect(() => {
    let cancelled = false
    const view = document.createElement('foliate-view') as FoliateView
    view.style.cssText = 'display:block;width:100%;height:100%'
    let coverObjectUrl = ''
    const syncDir = () => setDir(view.book.dir === 'ltr' ? 'ltr' : 'rtl')

    ;(async () => {
      try {
        const rec = await getBook(id)
        if (!rec) throw new Error(t('reader.bookMissing'))
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

        applySettings(view, settingsRef.current, faceRef.current)

        setTitle(rec.title)
        const lang = [view.book.metadata?.language].flat()[0]
        bookLang.current = typeof lang === 'string' ? (lang.split(/[-_]/)[0] ?? '').toLowerCase() : ''
        setLang(bookLang.current)
        fixBookDir(view, bookLang.current, rec.title)
        guardBookEdges(view)
        syncDir()
        setToc(flattenToc(view.book.toc))

        const on = <T,>(type: string, fn: (detail: T) => void) =>
          view.addEventListener(type, (e) => fn((e as CustomEvent<T>).detail))
        on<{ doc: Document; index: number }>('load', (d) => {
          markOwnStyles(d.doc)
          setBookStyles(d.doc, settingsRef.current.bookStyles)
          alignDocDir(view, d.doc)
          if (isFixedLayout(view)) resetPageScroll(view)
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

        const cfi = startCfi ?? rec.cfi
        if (!cfi) startAtFirstSection(view)
        await view.init({ lastLocation: cfi, showTextStart: !cfi })
        // a book whose file was made again (lib/db saveReconverted) knows only how far in the reader was
        if (!cfi && rec.fraction) await view.goToFraction(rec.fraction)
        else if (!cfi && rec.cover && !(await firstSectionShowsImage(view)) && !cancelled) {
          coverObjectUrl = URL.createObjectURL(rec.cover)
          setCoverUrl(coverObjectUrl)
        }
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
      if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl)
      setCoverUrl('')
      try {
        view.close?.()
      } catch {
        /* view may already be closed or half-initialised; teardown continues with remove() */
      }
      view.remove()
      viewRef.current = null
    }
  }, [id, startCfi, host, viewRef, h, settingsRef, faceRef])

  // apply settings changes live
  useEffect(() => {
    if (viewRef.current) applySettings(viewRef.current, settings, customFace)
  }, [viewRef, settings, customFace])

  return { status, error, title, dir, toc, bookLang, lang, coverUrl }
}
