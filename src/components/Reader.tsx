import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { compare as cfiCompare } from 'foliate-js/epubcfi.js'
import type { FoliateRelocateDetail, FoliateView } from 'foliate-js/view.js'
import { EditNotePanel, NotesPanel } from './reader/NotesPanels'
import { SearchPanel } from './reader/SearchPanel'
import { SettingsPanel } from './reader/SettingsPanel'
import { COLOR_NAMES, HIGHLIGHT_COLORS } from './reader/colors'
import { Icon } from './reader/shared'
import { flattenToc, type FlatTocItem } from './reader/toc'
import { TocPanel } from './reader/TocPanel'
import { useBookSearch } from './reader/useBookSearch'
import { useBookKeys, type KeyActions } from '../hooks/useBookKeys'
import { useReadingTracker } from '../hooks/useReadingTracker'
import { clampFont, useBookEvents, type Selection } from '../hooks/useBookEvents'
import { getBook, getNotes, newId, saveNotes, type Annotation } from '../lib/db'
import { download } from '../lib/download'
import { bookFromSections } from '../lib/pdfToBook'
import { formatMinutes, minutesLeft } from '../lib/stats'
import { bookCSS, loadSettings, saveSettings, themeColors, type Settings } from '../lib/settings'

export default function Reader({ id, onClose }: { id: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const settingsRef = useRef(settings)

  const [title, setTitle] = useState('')
  const [dir, setDir] = useState<'rtl' | 'ltr'>('rtl')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [uiVisible, setUiVisible] = useState(true)
  const [panel, setPanel] = useState<'toc' | 'settings' | 'search' | 'notes' | 'edit' | null>(null)
  const panelRef = useRef(panel)
  useEffect(() => {
    panelRef.current = panel
  }, [panel])
  const [toc, setToc] = useState<FlatTocItem[]>([])
  /** primary language subtag of the open book ("he", "en", …), '' when unknown */
  const bookLang = useRef('')
  const [fraction, setFraction] = useState(0)
  const [dragFraction, setDragFraction] = useState<number | null>(null)
  const [pages, setPages] = useState<{ current: number; total: number; approx: boolean } | null>(null)
  const [chapter, setChapter] = useState('')

  const [notes, setNotes] = useState<Annotation[]>([])
  const notesRef = useRef<Annotation[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  /** text currently selected in the book, with where to float the colour bar */
  const [selection, setSelection] = useState<Selection | null>(null)
  const selectionRef = useRef(selection)
  useLayoutEffect(() => {
    settingsRef.current = settings
    selectionRef.current = selection
  })
  const lastAnnotationClick = useRef(0)
  const [toast, setToast] = useState('')
  const [left, setLeft] = useState<number | null>(null)
  const actions = useRef<KeyActions>({ bookmark: () => {}, gotoBookmark: () => {}, bump: () => {}, panel: () => {}, hideBars: () => {} })
  const attachDocHandlers = useBookEvents({
    viewRef,
    settingsRef,
    panelRef,
    lastAnnotationClick,
    setSettings,
    setSelection,
    setUiVisible,
    setPanel,
  })

  const tracker = useReadingTracker(id)
  const closePanel = useCallback(() => setPanel(null), [])
  const onKey = useBookKeys({ viewRef, actions, closePanel, markActive: tracker.markActive })

  const toastTimer = useRef<number | undefined>(undefined)
  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const commitNotes = useCallback(
    (next: Annotation[]) => {
      notesRef.current = next
      setNotes(next)
      saveNotes(id, next).catch((e) => {
        console.error(e)
        flash(e instanceof Error && e.name === 'QuotaExceededError' ? 'אין מקום באחסון — ההערה לא נשמרה' : 'שמירת ההערה נכשלה')
      })
    },
    [id, flash],
  )

  // page-size calibration: bytes of source per rendered page, per section visited since last re-layout
  const calib = useRef(new Map<number, { pages: number; size: number }>())
  const lastDetail = useRef<FoliateRelocateDetail | null>(null)

  const recompute = useCallback((detail?: FoliateRelocateDetail) => {
    const view = viewRef.current
    const r = view?.renderer
    const d = detail ?? lastDetail.current
    if (!r || !d?.section || typeof r.pages !== 'number') return
    const sections = view.book.sections
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
    // the total is an estimate until every section with text has been laid out
    const approx = sizes.some((sz, i) => sz > 0 && !calib.current.has(i))
    setPages({ current, total, approx })
  }, [])

  // ---- open the book ----
  useEffect(() => {
    let cancelled = false
    const view = document.createElement('foliate-view') as FoliateView
    view.style.cssText = 'display:block;width:100%;height:100%'

    ;(async () => {
      try {
        const rec = await getBook(id)
        const savedNotes = await getNotes(id)
        notesRef.current = savedNotes
        setNotes(savedNotes)
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
        if (s.pageTransition) r.setAttribute?.('animated', '')
        else r.removeAttribute?.('animated')
        r.setStyles?.(bookCSS(s))

        setTitle(rec.title)
        setDir(view.book.dir === 'ltr' ? 'ltr' : 'rtl')
        const lang = [view.book.metadata?.language].flat()[0]
        bookLang.current = typeof lang === 'string' ? (lang.split(/[-_]/)[0] ?? '').toLowerCase() : ''
        setToc(flattenToc(view.book.toc))

        const on = <T,>(type: string, fn: (detail: T) => void) =>
          view.addEventListener(type, (e) => fn((e as CustomEvent<T>).detail))
        on<{ doc: Document; index: number }>('load', (d) => attachDocHandlers(d, onKey))
        on<{ draw: (fn: typeof Overlayer.highlight, opts: object) => void; annotation: { color: string } }>(
          'draw-annotation',
          ({ draw, annotation }) => draw(Overlayer.highlight, { color: annotation.color }),
        )
        on('create-overlay', () => {
          for (const n of notesRef.current) {
            if (n.kind === 'highlight') view.addAnnotation({ value: n.cfi, color: n.color }).catch(console.error)
          }
        })
        on<{ value: string }>('show-annotation', (d) => {
          const n = notesRef.current.find((x) => x.cfi === d.value)
          if (!n) return
          lastAnnotationClick.current = Date.now()
          setEditingId(n.id)
          setPanel('edit')
        })
        on<FoliateRelocateDetail>('relocate', (d) => {
          lastDetail.current = d
          const f = d.fraction ?? 0
          tracker.relocate(d)
          minutesLeft(id, f).then((m) => !cancelled && setLeft(m))
          setFraction(f)
          setChapter(d.tocItem?.label ?? '')
          requestAnimationFrame(() => recompute(d))
        })

        await view.init({ lastLocation: rec.cfi, showTextStart: !rec.cfi })
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
      try {
        view.close?.()
      } catch {
        /* ignore */
      }
      view.remove()
      viewRef.current = null
    }
  }, [id, recompute, attachDocHandlers, onKey, tracker])

  // ---- apply settings changes live ----
  useEffect(() => {
    saveSettings(settings)
    const v = viewRef.current
    if (!v) return
    v.renderer.setAttribute?.('flow', settings.flow)
    if (settings.pageTransition) v.renderer.setAttribute?.('animated', '')
    else v.renderer.removeAttribute?.('animated')
    v.renderer.setStyles?.(bookCSS(settings))
    calib.current.clear() // layout changed: page size must be re-measured
    const t = window.setTimeout(() => recompute(), 400)
    const t2 = window.setTimeout(() => recompute(), 1200)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(t2)
    }
  }, [settings, recompute])

  const search = useBookSearch(viewRef, panel === 'search')

  const addHighlight = (color: string) => {
    const sel = selectionRef.current
    const view = viewRef.current
    if (!sel || !view) return
    const note: Annotation = {
      id: newId(),
      kind: 'highlight',
      cfi: sel.cfi,
      text: sel.text,
      color,
      // oxlint-disable-next-line react/purity -- runs in a click handler, not during render
      createdAt: Date.now(),
    }
    commitNotes([...notesRef.current, note])
    view.addAnnotation({ value: note.cfi, color }).catch(console.error)
    view.renderer.getContents?.().forEach((c) => c.doc?.getSelection()?.removeAllRanges())
    setSelection(null)
  }

  const updateNote = (noteId: string, patch: Partial<Annotation>) => {
    const next = notesRef.current.map((n) => (n.id === noteId ? { ...n, ...patch } : n))
    commitNotes(next)
    const n = next.find((x) => x.id === noteId)
    if (n && patch.color && n.kind === 'highlight') {
      viewRef.current?.addAnnotation({ value: n.cfi, color: n.color }).catch(console.error)
    }
  }

  const removeNote = (noteId: string) => {
    const n = notesRef.current.find((x) => x.id === noteId)
    if (!n) return
    commitNotes(notesRef.current.filter((x) => x.id !== noteId))
    if (n.kind === 'highlight') viewRef.current?.deleteAnnotation({ value: n.cfi }).catch(console.error)
  }

  const toggleBookmark = () => {
    const d = lastDetail.current
    if (!d?.cfi) return
    const existing = notesRef.current.find((n) => n.kind === 'bookmark' && n.cfi === d.cfi)
    if (existing) {
      removeNote(existing.id)
      flash('הסימנייה הוסרה')
      return
    }
    const label = [chapter, `${Math.round((d.fraction ?? 0) * 100)}%`].filter(Boolean).join(' · ')
    commitNotes([
      ...notesRef.current,
      { id: newId(), kind: 'bookmark', cfi: d.cfi, text: label, color: HIGHLIGHT_COLORS[0] ?? '', createdAt: Date.now() },
    ])
    flash('נוספה סימנייה')
  }

  /** jump to the next (dir 1) or previous (dir -1) bookmark of this book, in reading order */
  const gotoBookmark = (dir: 1 | -1) => {
    const marks = notesRef.current
      .filter((n) => n.kind === 'bookmark')
      .sort((a, b) => cfiCompare(a.cfi, b.cfi))
    if (!marks.length) return flash('אין סימניות בספר')
    const here = lastDetail.current?.cfi
    const target = here
      ? dir === 1
        ? marks.find((n) => cfiCompare(n.cfi, here) > 0)
        : [...marks].reverse().find((n) => cfiCompare(n.cfi, here) < 0)
      : marks[0]
    if (!target) return flash(dir === 1 ? 'אין סימנייה נוספת קדימה' : 'אין סימנייה קודמת')
    viewRef.current?.goTo(target.cfi)
    flash(target.text)
  }

  const exportMarkdown = () => {
    const list = [...notesRef.current].sort((a, b) => a.createdAt - b.createdAt)
    if (!list.length) return flash('אין מה לייצא')
    const quote = (s: string) => s.replace(/\s*\n\s*/g, ' ')
    const lines = [`# ${title}`, '']
    const marks = list.filter((n) => n.kind === 'bookmark')
    const hls = list.filter((n) => n.kind === 'highlight')
    if (hls.length) {
      lines.push('## הדגשות', '')
      for (const n of hls) {
        lines.push(`> ${quote(n.text)}`)
        if (n.note) lines.push('', n.note)
        lines.push('')
      }
    }
    if (marks.length) lines.push('## סימניות', '', ...marks.map((n) => `- ${n.text}`), '')
    download(
      new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }),
      `${title.replace(/[\\/:*?"<>|]/g, '_') || 'הערות'}.md`,
    )
  }

  const lookUp = () => {
    const word = selectionRef.current?.text.trim().split(/\s+/)[0]?.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '')
    if (!word) return
    let lang = settingsRef.current.dictLang
    if (lang === 'auto') lang = bookLang.current || (/\p{Script=Hebrew}/u.test(word) ? 'he' : 'en')
    window.open(`https://${lang}.wiktionary.org/wiki/${encodeURIComponent(word)}`, '_blank', 'noopener')
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }))
  const bump = (d: number) => set('fontSize', clampFont(settings.fontSize + d))

  useLayoutEffect(() => {
    actions.current = {
      bookmark: toggleBookmark,
      gotoBookmark,
      bump: (d) => setSettings((s) => ({ ...s, fontSize: clampFont(s.fontSize + d) })),
      panel: (p) => setPanel((cur) => (cur === p ? null : p)),
      hideBars: () => setUiVisible(false),
    }
  })

  const editingNote = notes.find((x) => x.id === editingId)
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
        <button onClick={onClose} aria-label="חזרה לספרייה" title="חזרה לספרייה">→</button>
        <div className="title">{title}</div>
        {notes.some((n) => n.kind === 'bookmark') && (
          <>
            <button onClick={() => gotoBookmark(-1)} aria-label="סימנייה קודמת" title="סימנייה קודמת ([)">
              <Icon d="M19 20 9 12l10-8zM5 4v16" />
            </button>
            <button onClick={() => gotoBookmark(1)} aria-label="סימנייה הבאה" title="סימנייה הבאה (])">
              <Icon d="M5 4l10 8-10 8zM19 4v16" />
            </button>
          </>
        )}
        <button onClick={toggleBookmark} aria-label="סימנייה" title="הוסף/הסר סימנייה">
          <Icon d="M6 3h12v18l-6-4-6 4z" />
        </button>
        <button onClick={() => setPanel(panel === 'notes' ? null : 'notes')} aria-label="סימניות והדגשות" title="סימניות והדגשות">
          <Icon d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />
        </button>
        <button onClick={() => setPanel(panel === 'toc' ? null : 'toc')} aria-label="תוכן עניינים" title="תוכן עניינים">
          <Icon d="M4 6h16M4 12h16M4 18h16" />
        </button>
        <button onClick={() => setPanel(panel === 'search' ? null : 'search')} aria-label="חיפוש" title="חיפוש">
          <Icon d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5" />
        </button>
        <button onClick={() => setPanel(panel === 'settings' ? null : 'settings')} aria-label="הגדרות תצוגה" title="הגדרות תצוגה">Aa</button>
      </div>

      <div className={'bottombar' + (uiVisible ? '' : ' hidden')}>
        <div className="progress">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            dir={dir}
            value={shownFraction}
            aria-label="מיקום בספר"
            onChange={(e) => setDragFraction(parseFloat(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
          />
          <div className="label">
            {pages ? `עמוד ${pages.approx ? '~' : ''}${pages.current} מתוך ${pages.approx ? '~' : ''}${pages.total}` : ''}
            {pages ? ' · ' : ''}
            {Math.round(shownFraction * 100)}%{chapter ? ` · ${chapter}` : ''}
            {left ? ` · נותרו ~${formatMinutes(left)}` : ''}
          </div>
        </div>
      </div>

      {selection && !panel && (
        <div
          className="sel-bar"
          style={{
            left: Math.min(Math.max(selection.x, 90), window.innerWidth - 90),
            top: selection.y > 110 ? selection.y - 48 : selection.y + 40,
          }}
          onPointerDown={(e) => e.preventDefault()}
        >
          {HIGHLIGHT_COLORS.map((c, i) => (
            <button key={c} className="swatch" style={{ background: c }} aria-label={`הדגש בצבע ${COLOR_NAMES[i]}`} onClick={() => addHighlight(c)} />
          ))}
          <button aria-label="חפש במילון" title="מילון" onClick={lookUp}>📖</button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {panel === 'notes' && (
        <NotesPanel
          notes={notes}
          onExport={exportMarkdown}
          onRemove={removeNote}
          onGoTo={(cfi) => {
            viewRef.current?.goTo(cfi)
            setPanel(null)
          }}
          onEdit={(noteId) => {
            setEditingId(noteId)
            setPanel('edit')
          }}
        />
      )}

      {panel === 'edit' && editingNote && (
        <EditNotePanel
          note={editingNote}
          onUpdate={(patch) => updateNote(editingNote.id, patch)}
          onRemove={() => {
            removeNote(editingNote.id)
            setPanel(null)
          }}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === 'toc' && (
        <TocPanel
          toc={toc}
          onGoTo={(href) => {
            viewRef.current?.goTo(href)
            setPanel(null)
          }}
        />
      )}

      {panel === 'search' && (
        <SearchPanel
          query={search.query}
          onQueryChange={search.setQuery}
          results={search.results}
          searching={search.searching}
          capped={search.capped}
          onSearch={search.run}
          onCancel={search.cancel}
          onGoTo={(cfi) => {
            viewRef.current?.goTo(cfi)
            setPanel(null)
          }}
        />
      )}

      {panel === 'settings' && <SettingsPanel settings={settings} set={set} bump={bump} />}
    </div>
  )
}
