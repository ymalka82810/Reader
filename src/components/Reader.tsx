import { useCallback, useEffect, useRef, useState } from 'react'
import 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { getBook, getNotes, newId, saveNotes, updateProgress, type Annotation } from '../lib/db'
import { download } from '../lib/download'
import { bookFromSections } from '../lib/pdfToBook'
import { addStats, formatMinutes, minutesLeft } from '../lib/stats'
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

interface SearchExcerpt {
  pre: string
  match: string
  post: string
}

interface SearchGroup {
  label: string
  items: { cfi: string; excerpt: SearchExcerpt }[]
}

const flatten = (items: TocItem[] | null | undefined, depth = 0): (TocItem & { depth: number })[] =>
  (items ?? []).flatMap((i) => [{ ...i, depth }, ...flatten(i.subitems, depth + 1)])

const HIGHLIGHT_COLORS = ['#f2c744', '#5fbf6a', '#4a9be8', '#e8688c']
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
  const [panel, setPanel] = useState<'toc' | 'settings' | 'search' | 'notes' | 'edit' | null>(null)
  const panelRef = useRef(panel)
  useEffect(() => {
    panelRef.current = panel
  }, [panel])
  const [toc, setToc] = useState<(TocItem & { depth: number })[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchGroup[]>([])
  const [searching, setSearching] = useState(false)
  const searchToken = useRef(0)
  const [fraction, setFraction] = useState(0)
  const [dragFraction, setDragFraction] = useState<number | null>(null)
  const [pages, setPages] = useState<{ current: number; total: number } | null>(null)
  const [chapter, setChapter] = useState('')

  const [notes, setNotes] = useState<Annotation[]>([])
  const notesRef = useRef<Annotation[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  /** text currently selected in the book, with where to float the colour bar */
  const [selection, setSelection] = useState<{ cfi: string; text: string; x: number; y: number } | null>(null)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const lastAnnotationClick = useRef(0)
  const [toast, setToast] = useState('')
  const [left, setLeft] = useState<number | null>(null)
  const actions = useRef({ bookmark: () => {}, bump: (_d: number) => {}, panel: (_p: NonNullable<typeof panel>) => {} })
  const titleRef = useRef('')
  titleRef.current = title

  const commitNotes = useCallback(
    (next: Annotation[]) => {
      notesRef.current = next
      setNotes(next)
      saveNotes(id, next).catch(console.error)
    },
    [id],
  )
  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 1800)
  }

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
    let pendingSave: (() => void) | undefined
    const flushProgress = () => {
      window.clearTimeout(saveTimer)
      pendingSave?.()
      pendingSave = undefined
    }
    window.addEventListener('pagehide', flushProgress)
    const view: any = document.createElement('foliate-view')
    view.style.cssText = 'display:block;width:100%;height:100%'

    // reading speed: count active seconds (page turned / key pressed in the last 90s) and forward progress
    let lastActive = Date.now()
    let lastFraction: number | null = null
    let pendingFrac = 0
    const statsTimer = window.setInterval(() => {
      const active = !document.hidden && Date.now() - lastActive < 90_000
      addStats(id, active ? 5 : 0, pendingFrac)
      pendingFrac = 0
    }, 5000)

    const onKey = (e: KeyboardEvent) => {
      const v = viewRef.current
      if (!v) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      lastActive = Date.now()
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowLeft') v.goLeft()
      else if (e.key === 'ArrowRight') v.goRight()
      else if (e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        v.next()
      } else if (e.key === 'PageUp') v.prev()
      else if (e.key === 'Escape') setPanel(null)
      else if (e.key === '+' || e.key === '=') actions.current.bump(2)
      else if (e.key === '-') actions.current.bump(-2)
      else if (e.code === 'KeyB') actions.current.bookmark()
      else if (e.code === 'KeyT') actions.current.panel('toc')
      else if (e.code === 'KeyN') actions.current.panel('notes')
      else if (e.code === 'KeyS') actions.current.panel('settings')
      else if (e.key === '/' || e.code === 'Slash') {
        e.preventDefault()
        actions.current.panel('search')
      }
    }

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
        r.setStyles?.(bookCSS(s))

        setTitle(rec.title)
        setDir(view.book.dir === 'ltr' ? 'ltr' : 'rtl')
        setToc(flatten(view.book.toc))

        view.addEventListener('load', (e: CustomEvent) => {
          const doc: Document = e.detail.doc
          const index: number = e.detail.index
          doc.addEventListener('keydown', onKey)
          doc.addEventListener('selectionchange', () => {
            const sel = doc.getSelection()
            const text = sel?.toString().trim()
            if (!sel || sel.isCollapsed || !text) {
              // short delay so a tap on the colour bar still finds the selection
              window.setTimeout(() => {
                if (!doc.getSelection()?.toString().trim()) setSelection((cur) => (cur ? null : cur))
              }, 150)
              return
            }
            const range = sel.getRangeAt(0)
            const rect = range.getBoundingClientRect()
            const fr = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect()
            try {
              setSelection({
                cfi: view.getCFI(index, range),
                text,
                x: (fr?.left ?? 0) + rect.left + rect.width / 2,
                y: (fr?.top ?? 0) + rect.top,
              })
            } catch (err) {
              console.error(err)
            }
          })
          doc.addEventListener('click', (ev: MouseEvent) => {
            const t = ev.target as Element
            if (t.closest?.('a')) return
            if (doc.getSelection()?.toString()) return
            // a tap on a highlight opens it; the overlay handler fires on the same event
            if (Date.now() - lastAnnotationClick.current < 300) return
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
        view.addEventListener('draw-annotation', (e: CustomEvent) => {
          const { draw, annotation } = e.detail
          draw(Overlayer.highlight, { color: annotation.color })
        })
        view.addEventListener('create-overlay', () => {
          for (const n of notesRef.current) {
            if (n.kind === 'highlight') view.addAnnotation({ value: n.cfi, color: n.color }).catch(() => {})
          }
        })
        view.addEventListener('show-annotation', (e: CustomEvent) => {
          const n = notesRef.current.find((x) => x.cfi === e.detail.value)
          if (!n) return
          lastAnnotationClick.current = Date.now()
          setEditingId(n.id)
          setPanel('edit')
        })
        view.addEventListener('relocate', (e: CustomEvent) => {
          const d = e.detail
          lastDetail.current = d
          const f: number = d.fraction ?? 0
          lastActive = Date.now()
          // only small forward steps count as reading; jumps via the slider / TOC / search don't
          if (lastFraction !== null && f > lastFraction && f - lastFraction < 0.05) pendingFrac += f - lastFraction
          lastFraction = f
          setLeft(minutesLeft(id, f))
          setFraction(f)
          setChapter(d.tocItem?.label ?? '')
          requestAnimationFrame(() => recompute(d))
          window.clearTimeout(saveTimer)
          if (d.cfi) {
            pendingSave = () => updateProgress(id, d.cfi, d.fraction ?? 0)
            saveTimer = window.setTimeout(flushProgress, 800)
          }
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
      window.clearInterval(statsTimer)
      addStats(id, 0, pendingFrac)
      window.clearTimeout(saveTimer)
      flushProgress() // don't lose the last position if the book is closed within the debounce window
      window.removeEventListener('pagehide', flushProgress)
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

  const runSearch = useCallback(async (query: string) => {
    const view = viewRef.current
    const token = ++searchToken.current
    if (!view || !query.trim()) {
      view?.clearSearch()
      setSearchResults([])
      return
    }
    setSearching(true)
    setSearchResults([])
    try {
      for await (const r of view.search({ query })) {
        if (token !== searchToken.current) return
        if (r === 'done') break
        if (r.subitems) setSearchResults((prev) => [...prev, { label: r.label, items: r.subitems }])
      }
    } finally {
      if (token === searchToken.current) setSearching(false)
    }
  }, [])

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
      createdAt: Date.now(),
    }
    commitNotes([...notesRef.current, note])
    view.addAnnotation({ value: note.cfi, color }).catch(console.error)
    view.renderer.getContents?.().forEach((c: any) => c.doc?.getSelection()?.removeAllRanges())
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
      { id: newId(), kind: 'bookmark', cfi: d.cfi, text: label, color: HIGHLIGHT_COLORS[0], createdAt: Date.now() },
    ])
    flash('נוספה סימנייה')
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
    const word = selectionRef.current?.text.split(/\s+/)[0]
    if (word) window.open(`https://he.wiktionary.org/wiki/${encodeURIComponent(word.replace(/[^\p{L}\p{M}'-]/gu, ''))}`, '_blank', 'noopener')
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }))
  const bump = (d: number) => set('fontSize', Math.min(MAX_FONT, Math.max(MIN_FONT, settings.fontSize + d)))

  actions.current = {
    bookmark: toggleBookmark,
    bump: (d) => setSettings((s) => ({ ...s, fontSize: Math.min(MAX_FONT, Math.max(MIN_FONT, s.fontSize + d)) })),
    panel: (p) => setPanel((cur) => (cur === p ? null : p)),
  }

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
        <button onClick={toggleBookmark} aria-label="סימנייה">🔖</button>
        <button onClick={() => setPanel(panel === 'notes' ? null : 'notes')} aria-label="סימניות והדגשות">📝</button>
        <button onClick={() => setPanel(panel === 'toc' ? null : 'toc')} aria-label="תוכן עניינים">☰</button>
        <button onClick={() => setPanel(panel === 'search' ? null : 'search')} aria-label="חיפוש">🔍</button>
        <button onClick={() => setPanel(panel === 'settings' ? null : 'settings')} aria-label="הגדרות תצוגה">Aa</button>
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
            aria-label="מיקום בספר"
            onChange={(e) => setDragFraction(parseFloat(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
          />
          <div className="label">
            {pages ? `עמוד ${pages.current} מתוך ${pages.total}` : ''}
            {pages ? ' · ' : ''}
            {Math.round(shownFraction * 100)}%{chapter ? ` · ${chapter}` : ''}
            {left ? ` · נותרו ~${formatMinutes(left)}` : ''}
          </div>
        </div>
        {settings.flow === 'paginated' && (
          <button onClick={() => viewRef.current?.goLeft()} aria-label="הקודם">›</button>
        )}
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
        <Panel label="סימניות והדגשות">
          <h3>סימניות והדגשות</h3>
          {notes.length > 0 && <button onClick={exportMarkdown}>ייצוא ל-Markdown</button>}
          {notes.length === 0 && (
            <p className="muted">אין עדיין. סמן טקסט כדי להדגיש אותו, או לחץ על 🔖 כדי לשמור מקום.</p>
          )}
          <ul className="notes">
            {[...notes]
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((n) => (
                <li key={n.id}>
                  <button
                    className="note-main"
                    onClick={() => {
                      viewRef.current?.goTo(n.cfi)
                      setPanel(null)
                    }}
                  >
                    <span className="note-kind" style={{ background: n.kind === 'bookmark' ? 'transparent' : n.color }}>
                      {n.kind === 'bookmark' ? '🔖' : ''}
                    </span>
                    <span>
                      {n.text}
                      {n.note && <small className="note-text">{n.note}</small>}
                    </span>
                  </button>
                  {n.kind === 'highlight' && (
                    <button
                      aria-label="ערוך"
                      onClick={() => {
                        setEditingId(n.id)
                        setPanel('edit')
                      }}
                    >
                      ✎
                    </button>
                  )}
                  <button aria-label="מחק" onClick={() => removeNote(n.id)}>✕</button>
                </li>
              ))}
          </ul>
        </Panel>
      )}

      {panel === 'edit' &&
        (() => {
          const n = notes.find((x) => x.id === editingId)
          if (!n) return null
          return (
            <Panel label="עריכת הדגשה" className="edit">
              <blockquote style={{ borderColor: n.color }}>{n.text}</blockquote>
              <textarea
                placeholder="הוסף הערה…"
                value={n.note ?? ''}
                onChange={(e) => updateNote(n.id, { note: e.target.value })}
                rows={4}
                autoFocus
              />
              <div className="row">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c}
                    className={'swatch' + (c === n.color ? ' on' : '')}
                    style={{ background: c }}
                    aria-label={`צבע ${COLOR_NAMES[HIGHLIGHT_COLORS.indexOf(c)]}`}
                    aria-pressed={c === n.color}
                    onClick={() => updateNote(n.id, { color: c })}
                  />
                ))}
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => {
                    removeNote(n.id)
                    setPanel(null)
                  }}
                >
                  מחק
                </button>
                <button className="primary" onClick={() => setPanel(null)}>סיום</button>
              </div>
            </Panel>
          )
        })()}

      {panel === 'toc' && (
        <Panel label="תוכן עניינים">
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
        </Panel>
      )}

      {panel === 'search' && (
        <Panel label="חיפוש בספר" className="search">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              runSearch(searchQuery)
            }}
          >
            <input
              type="search"
              placeholder="חיפוש בספר…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            <button type="submit" disabled={searching || !searchQuery.trim()}>
              חפש
            </button>
          </form>
          {searching && <p className="muted">מחפש…</p>}
          {!searching && searchQuery.trim() && searchResults.length === 0 && (
            <p className="muted">לא נמצאו תוצאות.</p>
          )}
          <ul className="search-results">
            {searchResults.map((group, gi) => (
              <li key={gi}>
                <strong>{group.label}</strong>
                <ul>
                  {group.items.map((item, ii) => (
                    <li key={ii}>
                      <button
                        onClick={() => {
                          viewRef.current?.goTo(item.cfi)
                          setPanel(null)
                        }}
                      >
                        {item.excerpt.pre}
                        <mark>{item.excerpt.match}</mark>
                        {item.excerpt.post}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {panel === 'settings' && (
        <Panel label="הגדרות תצוגה" className="settings">
          <div className="row">
            <button onClick={() => bump(-2)} aria-label="הקטן">א−</button>
            <input
              type="range"
              min={MIN_FONT}
              max={MAX_FONT}
              value={settings.fontSize}
              aria-label="גודל גופן"
              onChange={(e) => set('fontSize', parseInt(e.target.value))}
            />
            <button onClick={() => bump(2)} aria-label="הגדל">א+</button>
          </div>
          <div className="row">
            <label htmlFor="lh">ריווח שורות</label>
            <input
              id="lh"
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
          <label className="check">
            <input
              type="checkbox"
              checked={settings.accessible}
              onChange={(e) => set('accessible', e.target.checked)}
            />
            מצב נגיש (דיסלקסיה / ראייה חלשה): ריווח מוגדל וגופן פשוט
          </label>
          <ul className="shortcuts">
            <li><kbd>←</kbd> <kbd>→</kbd> <kbd>רווח</kbd> מעבר עמוד</li>
            <li><kbd>+</kbd> <kbd>-</kbd> גודל גופן</li>
            <li><kbd>b</kbd> סימנייה · <kbd>t</kbd> תוכן · <kbd>n</kbd> הערות</li>
            <li><kbd>/</kbd> חיפוש · <kbd>s</kbd> הגדרות · <kbd>Esc</kbd> סגירה</li>
          </ul>
        </Panel>
      )}
    </div>
  )
}

const COLOR_NAMES = ['צהוב', 'ירוק', 'כחול', 'ורוד']

/** floating panel that takes focus when it opens, so keyboard and screen-reader users land inside it */
function Panel({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
  }, [])
  return (
    <div ref={ref} className={`panel ${className}`} role="dialog" aria-label={label} tabIndex={-1}>
      {children}
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
        <button key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}
