import { useCallback, useEffect, useRef, useState } from 'react'
import 'foliate-js/view.js'
import { getBook, updateProgress } from '../lib/db'
import { bookFromSections } from '../lib/pdfToBook'
import {
  bookCSS,
  loadSettings,
  saveSettings,
  themeColors,
  type Flow,
  type Settings,
  type Theme,
} from '../lib/settings'

interface TocItem {
  label: string
  href: string
  subitems?: TocItem[]
}

const flatten = (items: TocItem[] | null | undefined, depth = 0): (TocItem & { depth: number })[] =>
  (items ?? []).flatMap((i) => [{ ...i, depth }, ...flatten(i.subitems, depth + 1)])

const MIN_FONT = 12
const MAX_FONT = 48
/** share of the screen width, on each side, that turns the page when tapped */
const EDGE = 0.3

export default function Reader({ id, onClose }: { id: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<any>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const [title, setTitle] = useState('')
  const [dir, setDir] = useState<'rtl' | 'ltr'>('rtl')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [uiVisible, setUiVisible] = useState(true)
  const [panel, setPanel] = useState<'toc' | 'settings' | null>(null)
  const panelRef = useRef(panel)
  useEffect(() => {
    panelRef.current = panel
  }, [panel])
  const [toc, setToc] = useState<(TocItem & { depth: number })[]>([])
  const [fraction, setFraction] = useState(0)
  const [dragFraction, setDragFraction] = useState<number | null>(null)
  const [pages, setPages] = useState<{ current: number; total: number } | null>(null)
  const [chapter, setChapter] = useState('')

  // page-size calibration: bytes of source per rendered page, per section visited since last re-layout
  const calib = useRef(new Map<number, { pages: number; size: number }>())
  const lastDetail = useRef<any>(null)

  const recompute = useCallback((detail?: any) => {
    const view = viewRef.current
    const r = view?.renderer
    const d = detail ?? lastDetail.current
    if (!r || !d?.section || typeof r.pages !== 'number') return
    const sections: { size?: number; linear?: string }[] = view.book.sections
    const sizes = sections.map((s) => (s.linear !== 'no' && (s.size ?? 0) > 0 ? s.size! : 0))
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
    setPages({ current, total })
  }, [])

  // ---- open the book ----
  useEffect(() => {
    let cancelled = false
    let saveTimer: number | undefined
    const view: any = document.createElement('foliate-view')
    view.style.cssText = 'display:block;width:100%;height:100%'

    const onKey = (e: KeyboardEvent) => {
      const v = viewRef.current
      if (!v) return
      if (e.key === 'ArrowLeft') v.goLeft()
      else if (e.key === 'ArrowRight') v.goRight()
      else if (e.key === 'PageDown') v.next()
      else if (e.key === 'PageUp') v.prev()
      else if (e.key === 'Escape') setPanel(null)
    }

    ;(async () => {
      try {
        const rec = await getBook(id)
        if (!rec) throw new Error('הספר לא נמצא בספרייה')
        if (cancelled) return
        host.current?.append(view)

        const source =
          rec.kind === 'pdf' && rec.pdf
            ? bookFromSections({ title: rec.title, author: rec.author, ...rec.pdf })
            : rec.file
        await view.open(source)
        if (cancelled) return
        viewRef.current = view

        const s = settingsRef.current
        const r = view.renderer
        r.setAttribute?.('flow', s.flow)
        r.setAttribute?.('gap', '5%')
        r.setStyles?.(bookCSS(s))

        setTitle(rec.title)
        setDir(view.book.dir === 'ltr' ? 'ltr' : 'rtl')
        setToc(flatten(view.book.toc))

        view.addEventListener('load', (e: CustomEvent) => {
          const doc: Document = e.detail.doc
          doc.addEventListener('keydown', onKey)
          doc.addEventListener('click', (ev: MouseEvent) => {
            const t = ev.target as Element
            if (t.closest?.('a')) return
            if (doc.getSelection()?.toString()) return
            if (panelRef.current) {
              setPanel(null)
              return
            }
            // click position relative to the whole screen (the iframe can be offset/scrolled)
            const frame = doc.defaultView?.frameElement as HTMLElement | null
            const x = (frame?.getBoundingClientRect().left ?? 0) + ev.clientX
            const w = window.innerWidth
            const v = viewRef.current
            if (x < w * EDGE) v?.goLeft()
            else if (x > w * (1 - EDGE)) v?.goRight()
            else setUiVisible((vis) => !vis)
          })
        })
        view.addEventListener('relocate', (e: CustomEvent) => {
          const d = e.detail
          lastDetail.current = d
          setFraction(d.fraction ?? 0)
          setChapter(d.tocItem?.label ?? '')
          requestAnimationFrame(() => recompute(d))
          window.clearTimeout(saveTimer)
          saveTimer = window.setTimeout(() => {
            if (d.cfi) updateProgress(id, d.cfi, d.fraction ?? 0)
          }, 800)
        })

        await view.init({ lastLocation: rec.cfi, showTextStart: !rec.cfi })
        window.addEventListener('keydown', onKey)
        setStatus('ready')
        window.setTimeout(() => recompute(), 600)
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
      window.clearTimeout(saveTimer)
      window.removeEventListener('keydown', onKey)
      try {
        view.close?.()
      } catch {
        /* ignore */
      }
      view.remove()
      viewRef.current = null
    }
  }, [id, recompute])

  // ---- apply settings changes live ----
  useEffect(() => {
    saveSettings(settings)
    const v = viewRef.current
    if (!v) return
    v.renderer.setAttribute?.('flow', settings.flow)
    v.renderer.setStyles?.(bookCSS(settings))
    calib.current.clear() // layout changed: page size must be re-measured
    const t = window.setTimeout(() => recompute(), 400)
    const t2 = window.setTimeout(() => recompute(), 1200)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(t2)
    }
  }, [settings, recompute])

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }))
  const bump = (d: number) => set('fontSize', Math.min(MAX_FONT, Math.max(MIN_FONT, settings.fontSize + d)))

  const colors = themeColors(settings.theme)
  const shownFraction = dragFraction ?? fraction
  const commit = () => {
    if (dragFraction !== null) viewRef.current?.goToFraction(dragFraction)
    setDragFraction(null)
  }

  return (
    <div
      className={`reader theme-${settings.theme}`}
      dir="rtl"
      style={{ ['--bg' as string]: colors.bg, ['--fg' as string]: colors.fg }}
    >
      <div className="view-host" ref={host} />

      {status === 'loading' && <div className="overlay-msg">טוען…</div>}
      {status === 'error' && (
        <div className="overlay-msg error">
          <p>{error}</p>
          <button onClick={onClose}>חזרה לספרייה</button>
        </div>
      )}

      <div className={'topbar' + (uiVisible ? '' : ' hidden')}>
        <button onClick={onClose} aria-label="חזרה לספרייה">→</button>
        <div className="title">{title}</div>
        <button onClick={() => setPanel(panel === 'toc' ? null : 'toc')}>☰</button>
        <button onClick={() => setPanel(panel === 'settings' ? null : 'settings')}>Aa</button>
      </div>

      <div className={'bottombar' + (uiVisible ? '' : ' hidden')}>
        {settings.flow === 'paginated' && (
          <button onClick={() => viewRef.current?.goRight()} aria-label="הבא">‹</button>
        )}
        <div className="progress">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            dir={dir}
            value={shownFraction}
            onChange={(e) => setDragFraction(parseFloat(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
          />
          <div className="label">
            {pages ? `עמוד ${pages.current} מתוך ${pages.total}` : ''}
            {pages ? ' · ' : ''}
            {Math.round(shownFraction * 100)}%{chapter ? ` · ${chapter}` : ''}
          </div>
        </div>
        {settings.flow === 'paginated' && (
          <button onClick={() => viewRef.current?.goLeft()} aria-label="הקודם">›</button>
        )}
      </div>

      {panel === 'toc' && (
        <div className="panel">
          <h3>תוכן עניינים</h3>
          {toc.length === 0 && <p className="muted">אין תוכן עניינים בספר הזה.</p>}
          <ul className="toc">
            {toc.map((t, i) => (
              <li key={i} style={{ paddingInlineStart: t.depth * 16 }}>
                <button
                  onClick={() => {
                    viewRef.current?.goTo(t.href)
                    setPanel(null)
                  }}
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {panel === 'settings' && (
        <div className="panel settings">
          <div className="row">
            <button onClick={() => bump(-2)} aria-label="הקטן">א−</button>
            <input
              type="range"
              min={MIN_FONT}
              max={MAX_FONT}
              value={settings.fontSize}
              onChange={(e) => set('fontSize', parseInt(e.target.value))}
            />
            <button onClick={() => bump(2)} aria-label="הגדל">א+</button>
          </div>
          <div className="row">
            <label>ריווח שורות</label>
            <input
              type="range"
              min={1.2}
              max={2.4}
              step={0.1}
              value={settings.lineHeight}
              onChange={(e) => set('lineHeight', parseFloat(e.target.value))}
            />
          </div>
          <Seg<Flow>
            value={settings.flow}
            onChange={(v) => set('flow', v)}
            options={[['scrolled', 'גלילה'], ['paginated', 'עמודים']]}
          />
          <Seg<Theme>
            value={settings.theme}
            onChange={(v) => set('theme', v)}
            options={[['light', 'בהיר'], ['sepia', 'ספיה'], ['dark', 'כהה']]}
          />
          <Seg<Settings['fontFamily']>
            value={settings.fontFamily}
            onChange={(v) => set('fontFamily', v)}
            options={[['default', 'ברירת מחדל'], ['serif', 'סריף'], ['sans', 'סנס']]}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={settings.justify}
              onChange={(e) => set('justify', e.target.checked)}
            />
            יישור לשני הצדדים
          </label>
        </div>
      )}
    </div>
  )
}

function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: [T, string][]
}) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}
