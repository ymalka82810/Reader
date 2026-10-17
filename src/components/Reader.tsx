import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FoliateView } from 'foliate-js/view.js'
import { DictPanel } from './reader/DictPanel'
import { NavPanel } from './reader/NavPanel'
import { EditNotePanel, NotesList } from './reader/NotesPanels'
import { SearchPanel } from './reader/SearchPanel'
import { SettingsPanel } from './reader/SettingsPanel'
import { ViewModesSection } from './reader/ViewModesSection'
import { COLOR_NAMES, HIGHLIGHT_COLORS } from './reader/colors'
import { Icon } from './reader/shared'
import { TocList } from './reader/TocPanel'
import { useBookSearch } from './reader/useBookSearch'
import { useAnnotations } from '../hooks/useAnnotations'
import { useBookKeys, type KeyActions } from '../hooks/useBookKeys'
import { useFlash } from '../hooks/useFlash'
import { useFoliateView } from '../hooks/useFoliateView'
import { useLatest } from '../hooks/useLatest'
import { usePageEstimate } from '../hooks/usePageEstimate'
import { useReaderPanels } from '../hooks/useReaderPanels'
import { useEyeScroll } from '../hooks/useEyeScroll'
import { useViewModes } from '../hooks/useViewModes'
import { useReadingTracker } from '../hooks/useReadingTracker'
import { useAutoRead } from '../hooks/useAutoRead'
import { MAX_RATE, MIN_RATE, RATE_STEP, readAloudSupported, useReadAloud } from '../hooks/useReadAloud'
import { useBackGesture } from '../hooks/useBackGesture'
import { clampFont, useBookEvents, type Selection } from '../hooks/useBookEvents'
import { firstWord } from '../lib/dictionary'
import { formatMinutes, loadStats, minutesLeft, type Stats } from '../lib/stats'
import { customFontFace, loadCustomFont, type CustomFont } from '../lib/customFont'
import { loadViewModes, saveViewModes, type ViewModes } from '../lib/viewModes'
import { loadSettings, saveSettings, themeColors, type Settings } from '../lib/settings'

const TAP_HELP_KEY = 'reader:tapHelpSeen'
/** a second back swipe within this time leaves the book */
const BACK_AGAIN_MS = 2000
/** in distraction-free mode the bars shown by a middle tap go away again after this long */
const FOCUS_BARS_MS = 4000

export default function Reader({ id, onClose }: { id: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const settingsRef = useLatest(settings)
  const [modes, setModes] = useState<ViewModes>(loadViewModes)
  const [uiVisible, setUiVisible] = useState(true)
  const { panel, panelRef, setPanel, closePanel, togglePanel, editingId, editNote, dict, openDict } = useReaderPanels()
  const [fraction, setFraction] = useState(0)
  const [dragFraction, setDragFraction] = useState<number | null>(null)
  const [chapter, setChapter] = useState('')
  /** CFI of the current location, to show whether it is bookmarked */
  const [here, setHere] = useState('')
  /** href of the current table-of-contents entry, to mark it in the list */
  const [chapterHref, setChapterHref] = useState('')
  /** where the reader was before the last jump, so one tap can go back */
  const [backTo, setBackTo] = useState<{ cfi: string; page: number | null } | null>(null)
  const backTimer = useRef<number | undefined>(undefined)
  /** index of the search result the reader last went to, for the previous/next arrows */
  const [hitIdx, setHitIdx] = useState<number | null>(null)
  const [tapHelp, setTapHelp] = useState(() => {
    try {
      return !localStorage.getItem(TAP_HELP_KEY)
    } catch {
      return false
    }
  })

  /** text currently selected in the book, with where to float the colour bar */
  const [selection, setSelection] = useState<Selection | null>(null)
  const selectionRef = useLatest(selection)
  const lastAnnotationClick = useRef(0)
  const [left, setLeft] = useState<number | null>(null)
  /** read once per book: the estimate does not need to track the stats written while reading */
  const stats = useRef<Stats>({ secs: 0, frac: 0 })
  const actions = useRef<KeyActions>({
    bookmark: () => {},
    gotoBookmark: () => {},
    bump: () => {},
    panel: () => {},
    hideBars: () => {},
    autoRead: () => {},
    pace: () => {},
    readAloud: () => {},
    focus: () => {},
  })
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
  const onKey = useBookKeys({ viewRef, actions, closePanel, markActive: tracker.markActive })

  const { message: toast, flash } = useFlash()
  const estimate = usePageEstimate(viewRef)
  const { pages, recompute, resetCalibration, lastDetail } = estimate
  const notes = useAnnotations(id, viewRef, flash)

  // the uploaded font, loaded once; the view re-applies its styles when it arrives or changes
  const [customFont, setCustomFont] = useState<CustomFont>()
  useEffect(() => {
    void loadCustomFont().then(setCustomFont)
  }, [])

  const { status, error, title, dir, toc, bookLang } = useFoliateView(id, host, viewRef, settings, customFont ? customFontFace(customFont) : '', {
    prepare: async () => {
      const [, s] = await Promise.all([notes.load(), loadStats(id)])
      stats.current = s
    },
    load: (d) => attachDocHandlers(d, onKey),
    createOverlay: notes.drawAll,
    showAnnotation: (cfi) => {
      const n = notes.findByCfi(cfi)
      if (!n) return
      lastAnnotationClick.current = Date.now()
      editNote(n.id)
    },
    relocate: (d) => {
      estimate.relocate(d)
      const f = d.fraction ?? 0
      tracker.relocate(d)
      setLeft(minutesLeft(stats.current, f))
      setFraction(f)
      setChapter(d.tocItem?.label ?? '')
      setHere(d.cfi ?? '')
      setChapterHref(d.tocItem?.href ?? '')
    },
  })
  useEffect(() => {
    if (status !== 'ready') return
    const t = window.setTimeout(() => recompute(), 600)
    return () => window.clearTimeout(t)
  }, [status, recompute])

  // the phone's back swipe: closes an open panel, else shows the bars and asks for a second swipe
  // (so a stray edge swipe doesn't drop the reader out of the book)
  const lastBack = useRef(0)
  const leaveHistory = useBackGesture(() => {
    if (panelRef.current) {
      setPanel(null)
      return true
    }
    const now = Date.now()
    if (now - lastBack.current < BACK_AGAIN_MS) {
      onClose()
      return false
    }
    lastBack.current = now
    setUiVisible(true)
    flash('החלקה נוספת תחזיר לספרייה')
    return true
  })
  const close = useCallback(() => {
    leaveHistory()
    onClose()
  }, [leaveHistory, onClose])
  useEffect(
    () => () => {
      window.clearTimeout(backTimer.current)
    },
    [],
  )

  // ---- settings: save, and re-measure pages once the view has applied them ----
  useEffect(() => {
    saveSettings(settings)
    if (!viewRef.current) return
    resetCalibration() // layout changed: page size must be re-measured
    const t = window.setTimeout(() => recompute(), 400)
    const t2 = window.setTimeout(() => recompute(), 1200)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(t2)
    }
  }, [settings, customFont, recompute, resetCalibration])

  // ---- view modes: columns, orientation lock, distraction-free, eye scrolling ----
  useEffect(() => saveViewModes(modes), [modes])
  const setMode = <K extends keyof ViewModes>(k: K, v: ViewModes[K]) => setModes((m) => ({ ...m, [k]: v }))
  const relayout = useCallback(() => {
    resetCalibration()
    window.setTimeout(() => recompute(), 400)
  }, [resetCalibration, recompute])
  useViewModes({
    viewRef,
    ready: status === 'ready',
    settings,
    spread: modes.spread,
    focus: modes.focus,
    lock: modes.orientation,
    onLayout: relayout,
    flash,
  })
  const toggleFocus = () => {
    const on = !modes.focus
    setMode('focus', on)
    if (on) {
      setUiVisible(false)
      setPanel(null)
      flash('מצב ללא הסחות — הקשה באמצע מציגה תפריט לרגע')
    }
  }
  useEffect(() => {
    if (!modes.focus || !uiVisible || panel) return
    const t = window.setTimeout(() => setUiVisible(false), FOCUS_BARS_MS)
    return () => window.clearTimeout(t)
  }, [modes.focus, uiVisible, panel])

  const search = useBookSearch(viewRef, panel === 'search')
  const auto = useAutoRead({
    id,
    viewRef,
    lastDetail,
    flow: settings.flow,
    paused: uiVisible || !!panel || !!selection,
    markActive: tracker.markActive,
  })
  // search marks stay only while the search panel or the result stepper is open
  useEffect(() => {
    if (panel !== 'search' && hitIdx === null) viewRef.current?.clearSearch()
  }, [panel, hitIdx])
  const speech = useReadAloud({ viewRef, lastDetail, lang: bookLang })
  const eye = useEyeScroll({
    enabled: modes.eyeScroll && status === 'ready',
    viewRef,
    flow: settings.flow,
    paused: uiVisible || !!panel || !!selection,
    markActive: tracker.markActive,
  })
  const toggleAuto = () => {
    if (!auto.active) {
      setUiVisible(false)
      flash('קריאה אוטומטית — הקשה באמצע עוצרת ומציגה תפריטים')
      if (speech.active) void speech.toggle()
    }
    void auto.toggle()
  }
  const toggleSpeech = () => {
    if (!readAloudSupported) return flash('הקראה אינה נתמכת במכשיר זה')
    if (!speech.active) {
      setUiVisible(false)
      if (auto.active) void auto.toggle()
    }
    void speech.toggle()
  }

  /** go to a location, remembering the current one for a while so the reader can return to it */
  const jumpTo = (target: string | number, isFraction = false) => {
    const view = viewRef.current
    if (!view) return
    const cfi = lastDetail.current?.cfi
    if (cfi) {
      setBackTo({ cfi, page: pages?.current ?? null })
      window.clearTimeout(backTimer.current)
      backTimer.current = window.setTimeout(() => setBackTo(null), 20000)
    }
    if (isFraction) void view.goToFraction(target as number)
    else void view.goTo(target as string)
  }
  const goBack = () => {
    if (backTo) viewRef.current?.goTo(backTo.cfi)
    setBackTo(null)
  }

  const hits = useMemo(() => search.results.flatMap((g) => g.items), [search.results])
  const stepHit = (d: 1 | -1) => {
    if (!hits.length) return
    const next = ((hitIdx ?? (d === 1 ? -1 : 0)) + d + hits.length) % hits.length
    setHitIdx(next)
    viewRef.current?.goTo(hits[next]!.cfi)
  }

  const clearSelection = () => {
    viewRef.current?.renderer.getContents?.().forEach((c) => c.doc?.getSelection()?.removeAllRanges())
    setSelection(null)
  }

  const addHighlight = (color: string) => {
    const sel = selectionRef.current
    if (!sel || !viewRef.current) return undefined
    const noteId = notes.addHighlight(sel.cfi, sel.text, color)
    clearSelection()
    return noteId
  }

  const addNote = () => {
    const noteId = addHighlight(HIGHLIGHT_COLORS[0] ?? '')
    if (noteId) editNote(noteId)
  }

  const copySelection = () => {
    const text = selectionRef.current?.text
    if (!text) return
    navigator.clipboard
      ?.writeText(text)
      .then(() => flash('הועתק'))
      .catch(() => flash('ההעתקה נכשלה'))
    setSelection(null)
  }

  const shareSelection = () => {
    const text = selectionRef.current?.text
    if (!text) return
    navigator.share?.({ text, title }).catch(() => {})
    setSelection(null)
  }

  const toggleBookmark = () => {
    const d = lastDetail.current
    if (!d?.cfi) return
    notes.toggleBookmark(d.cfi, [chapter, `${Math.round((d.fraction ?? 0) * 100)}%`].filter(Boolean).join(' · '))
  }

  /** jump to the next (dir 1) or previous (dir -1) bookmark of this book, in reading order */
  const gotoBookmark = (dir: 1 | -1) => {
    const target = notes.bookmarkFrom(lastDetail.current?.cfi, dir)
    if (!target) return
    jumpTo(target.cfi)
    flash(target.text)
  }

  const lookUp = () => {
    const word = firstWord(selectionRef.current?.text ?? '')
    if (!word) return
    let lang = settingsRef.current.dictLang
    if (lang === 'auto') lang = bookLang.current || (/\p{Script=Hebrew}/u.test(word) ? 'he' : 'en')
    openDict(word, lang)
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }))
  const bump = (d: number) => set('fontSize', clampFont(settings.fontSize + d))

  useLayoutEffect(() => {
    actions.current = {
      bookmark: toggleBookmark,
      gotoBookmark,
      bump: (d) => setSettings((s) => ({ ...s, fontSize: clampFont(s.fontSize + d) })),
      panel: togglePanel,
      hideBars: () => setUiVisible(false),
      autoRead: toggleAuto,
      pace: auto.adjust,
      readAloud: toggleSpeech,
      focus: toggleFocus,
    }
  })

  const editingNote = notes.notes.find((x) => x.id === editingId)
  const bookmarked = !!here && notes.notes.some((n) => n.kind === 'bookmark' && n.cfi === here)
  const navOpen = panel === 'toc' || panel === 'notes'
  const colors = themeColors(settings)
  const shownFraction = dragFraction ?? fraction
  const commit = () => {
    if (dragFraction !== null) jumpTo(dragFraction, true)
    setDragFraction(null)
  }

  return (
    <div
      className={`reader theme-${settings.theme}${modes.focus ? ' focus' : ''}`}
      dir="rtl"
      style={{ ['--bg' as string]: colors.bg, ['--fg' as string]: colors.fg }}
    >
      <div className="view-host" ref={host} style={settings.brightness < 1 ? { filter: `brightness(${settings.brightness})` } : undefined} />

      {status === 'loading' && <div className="overlay-msg">טוען…</div>}
      {status === 'error' && (
        <div className="overlay-msg error">
          <p>{error}</p>
          <button onClick={close}>חזרה לספרייה</button>
        </div>
      )}

      <div className={'topbar' + (uiVisible ? '' : ' hidden')}>
        <button onClick={close} aria-label="חזרה לספרייה" title="חזרה לספרייה">→</button>
        <div className="title">{title}</div>
        <button
          onClick={toggleBookmark}
          aria-label="סימנייה"
          aria-pressed={bookmarked}
          title={bookmarked ? 'הסר סימנייה (b)' : 'הוסף סימנייה (b)'}
        >
          <Icon d="M6 3h12v18l-6-4-6 4z" filled={bookmarked} />
        </button>
        <button
          onClick={() => setPanel(navOpen ? null : 'toc')}
          aria-label="ניווט בספר"
          aria-expanded={navOpen}
          title="תוכן עניינים, סימניות והדגשות (t / n)"
        >
          <Icon d="M4 6h16M4 12h16M4 18h16" />
        </button>
        <button
          onClick={toggleFocus}
          aria-label="מצב ללא הסחות"
          aria-pressed={modes.focus}
          title="מצב ללא הסחות (f)"
        >
          <Icon d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </button>
        <button onClick={() => togglePanel('search')} aria-label="חיפוש" title="חיפוש">
          <Icon d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5" />
        </button>
        <button onClick={() => togglePanel('settings')} aria-label="הגדרות תצוגה" title="הגדרות תצוגה">Aa</button>
      </div>

      <div className={'bottombar' + (uiVisible ? '' : ' hidden')}>
        <button
          className="play"
          onClick={toggleAuto}
          aria-label={auto.active ? 'עצור קריאה אוטומטית' : 'קריאה אוטומטית'}
          aria-pressed={auto.active}
          title="קריאה אוטומטית בקצב שלך (a)"
        >
          <Icon d={auto.active ? 'M7 5v14M17 5v14' : 'M7 4v16l13-8z'} />
        </button>
        {auto.active && (
          <div className="auto-pace" role="group" aria-label="קצב קריאה אוטומטית">
            <button onClick={() => auto.adjust(false)} aria-label="לאט יותר" title="לאט יותר (,)">−</button>
            <span title="זמן לכל מסך, לפי קצב הקריאה שלך">{auto.secsPerScreen ? `${auto.secsPerScreen} שנ׳/מסך` : '…'}</span>
            <button onClick={() => auto.adjust(true)} aria-label="מהר יותר" title="מהר יותר (.)">+</button>
          </div>
        )}
        {speech.active && (
          <div className="auto-pace" role="group" aria-label="מהירות הקראה">
            <button onClick={() => speech.setRate(speech.rate - RATE_STEP)} disabled={speech.rate <= MIN_RATE} aria-label="הקראה איטית יותר" title="הקראה איטית יותר">−</button>
            <span>{`הקראה ×${speech.rate.toFixed(1)}`}</span>
            <button onClick={() => speech.setRate(speech.rate + RATE_STEP)} disabled={speech.rate >= MAX_RATE} aria-label="הקראה מהירה יותר" title="הקראה מהירה יותר">+</button>
          </div>
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
          <div className="label" title={chapter || undefined}>
            {pages ? `עמוד ${pages.current} מתוך ${pages.total} · ` : ''}
            {Math.round(shownFraction * 100)}%
            {left ? ` · נותרו ${formatMinutes(left)}` : ''}
          </div>
        </div>
        {readAloudSupported && (
          <button
            className="play"
            onClick={toggleSpeech}
            aria-label={speech.active ? 'עצור הקראה' : 'הקרא בקול'}
            aria-pressed={speech.active}
            title="הקראת הטקסט בקול (r)"
          >
            <Icon d={speech.active ? 'M6 6h12v12H6z' : 'M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12'} />
          </button>
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
          <button aria-label="הוסף הערה" title="הערה" onClick={addNote}>✎</button>
          <button aria-label="העתק" title="העתק" onClick={copySelection}>⧉</button>
          {typeof navigator.share === 'function' && (
            <button aria-label="שתף" title="שתף" onClick={shareSelection}>⇪</button>
          )}
          <button aria-label="חפש במילון" title="מילון" onClick={lookUp}>📖</button>
        </div>
      )}
      {(backTo || (hitIdx !== null && hits.length > 0)) && !panel && (
        <div className={'jump-chips' + (uiVisible ? '' : ' low')}>
          {backTo && <button onClick={goBack}>{backTo.page ? `↩ חזרה לעמוד ${backTo.page}` : '↩ חזרה'}</button>}
          {hitIdx !== null && hits.length > 0 && (
            <div className="hit-nav" role="group" aria-label="תוצאות חיפוש">
              <button onClick={() => stepHit(-1)} aria-label="התוצאה הקודמת" title="התוצאה הקודמת">›</button>
              <span>{`${Math.max(hitIdx, 0) + 1} / ${hits.length}`}</span>
              <button onClick={() => stepHit(1)} aria-label="התוצאה הבאה" title="התוצאה הבאה">‹</button>
              <button onClick={() => setHitIdx(null)} aria-label="סגור ניווט תוצאות" title="סגור">✕</button>
            </div>
          )}
        </div>
      )}
      {tapHelp && status === 'ready' && (
        <div
          className="tap-help"
          role="dialog"
          aria-label="הסבר על אזורי הלחיצה"
          onClick={() => {
            setTapHelp(false)
            try {
              localStorage.setItem(TAP_HELP_KEY, '1')
            } catch {
              /* private mode: the hint shows again next time */
            }
          }}
        >
          <div>הקשה בצד<br />מעבר עמוד</div>
          <div>הקשה באמצע<br />תפריטים</div>
          <div>הקשה בצד<br />מעבר עמוד</div>
          <p>הקש בכל מקום כדי להמשיך</p>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {(panel === 'toc' || panel === 'notes') && (
        <NavPanel tab={panel} onTab={setPanel}>
          {panel === 'toc' ? (
            <TocList
              toc={toc}
              currentHref={chapterHref}
              onGoTo={(href) => {
                jumpTo(href)
                setPanel(null)
              }}
            />
          ) : (
            <NotesList
              notes={notes.notes}
              onExport={() => notes.exportMarkdown(title)}
              onRemove={notes.remove}
              onGoTo={(cfi) => {
                jumpTo(cfi)
                setPanel(null)
              }}
              onGotoBookmark={(d) => {
                setPanel(null)
                gotoBookmark(d)
              }}
              onEdit={editNote}
            />
          )}
        </NavPanel>
      )}

      {panel === 'dict' && dict && <DictPanel word={dict.word} lang={dict.lang} onClose={() => setPanel(null)} />}

      {panel === 'edit' && editingNote && (
        <EditNotePanel
          note={editingNote}
          onUpdate={(patch) => notes.update(editingNote.id, patch)}
          onRemove={() => {
            notes.remove(editingNote.id)
            setPanel(null)
          }}
          onClose={closePanel}
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
            setHitIdx(hits.findIndex((h) => h.cfi === cfi))
            jumpTo(cfi)
            setPanel(null)
          }}
        />
      )}

      {panel === 'settings' && (
        <SettingsPanel settings={settings} set={set} bump={bump} customFont={customFont} setCustomFont={setCustomFont}>
          <ViewModesSection
            modes={modes}
            setMode={setMode}
            flow={settings.flow}
            eyeStatus={eye.status}
            onRecalibrate={eye.recalibrate}
          />
        </SettingsPanel>
      )}
    </div>
  )
}
