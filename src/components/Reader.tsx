import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FoliateView } from 'foliate-js/view.js'
import { ConsentGate } from './reader/ConsentGate'
import { DictPanel } from './reader/DictPanel'
import { TranslatePanel } from './reader/TranslatePanel'
import { NavPanel } from './reader/NavPanel'
import { EditNotePanel, NotesList } from './reader/NotesPanels'
import { QuoteShareDialog } from './reader/QuoteShareDialog'
import { SearchPanel } from './reader/SearchPanel'
import { SettingsPanel } from './reader/SettingsPanel'
import { ViewModesSection } from './reader/ViewModesSection'
import { ZoomSection } from './reader/ZoomSection'
import { ReadAloudSection } from './reader/ReadAloudSection'
import { COLOR_NAMES, HIGHLIGHT_COLORS } from './reader/colors'
import { Icon } from './reader/shared'
import { Dialog } from './Dialog'
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
import { saveWord } from '../lib/flashcards'
import { formatMinutes, loadStats, minutesLeft, type Stats } from '../lib/stats'
import { getLocale, isRtl, t } from '../i18n'
import { customFontFace, customFontUrl, loadCustomFont, releaseCustomFontUrl, type CustomFont } from '../lib/customFont'
import { EYE_SCROLL_AVAILABLE, loadViewModes, saveViewModes, type ViewModes } from '../lib/viewModes'
import { isNativeApp } from '../lib/updater'
import { applyA11yClasses, loadSettings, saveSettings, themeColors, type Settings } from '../lib/settings'
import { BookLoader } from './BookLoader'

const TAP_HELP_KEY = 'reader:tapHelpSeen'
/** a second back swipe within this time leaves the book */
/** in distraction-free mode the bars shown by a middle tap go away again after this long */
const FOCUS_BARS_MS = 4000

export default function Reader({ id, startCfi, onClose, onSettings }: { id: string; startCfi?: string; onClose: () => void; onSettings: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const settingsRef = useLatest(settings)
  const [modes, setModes] = useState<ViewModes>(() => {
    const m = loadViewModes()
    return isNativeApp ? { ...m, focus: false } : m // the app is already full screen: no distraction-free mode there
  })
  const [uiVisible, setUiVisible] = useState(true)
  const { panel, panelRef, setPanel, closePanel, togglePanel, editingId, editNote, dict, openDict, translation, openTranslate, quote, openQuote } = useReaderPanels()
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
    toggleBars: () => {},
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

  // the uploaded font, loaded once as a blob: URL shared by all chapters; the view re-applies its styles when it arrives
  const [customFont, setCustomFont] = useState<CustomFont>()
  const [fontUrl, setFontUrl] = useState('')
  useEffect(() => {
    let alive = true
    let url = ''
    void loadCustomFont().then(async (f) => {
      if (!f) return
      const u = await customFontUrl(f)
      if (!alive) return releaseCustomFontUrl(u)
      url = u
      setCustomFont(f)
      setFontUrl(u)
    })
    return () => {
      alive = false
      releaseCustomFontUrl(url)
    }
  }, [])

  const { status, error, title, dir, toc, bookLang, lang: language } = useFoliateView(id, host, viewRef, settings, fontUrl ? customFontFace(fontUrl) : '', startCfi, {
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

  // the phone's back swipe: closes an open panel, else goes back to the library
  useBackGesture(() => {
    if (panelRef.current) setPanel(null)
    else onClose()
  }, 1)
  const close = onClose
  useEffect(
    () => () => {
      window.clearTimeout(backTimer.current)
    },
    [],
  )

  // ---- settings: save, and re-measure pages once the view has applied them ----
  useEffect(() => {
    saveSettings(settings)
    applyA11yClasses(settings)
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
    if (isNativeApp) return
    const on = !modes.focus
    setMode('focus', on)
    if (on) {
      setUiVisible(false)
      setPanel(null)
      flash(t('reader.focusOn'))
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
  const speech = useReadAloud({
    viewRef,
    lastDetail,
    lang: bookLang,
    title,
    onFail: (why) => why !== 'interrupted' && flash(t(why === 'no-voice' ? 'reader.ttsNoVoice' : 'reader.ttsUnsupported')),
  })
  const eye = useEyeScroll({
    enabled: EYE_SCROLL_AVAILABLE && modes.eyeScroll && status === 'ready',
    viewRef,
    flow: settings.flow,
    paused: uiVisible || !!panel || !!selection,
    markActive: tracker.markActive,
  })
  const toggleAuto = () => {
    if (!auto.active) {
      setUiVisible(false)
      flash(t('reader.autoOn'))
      if (speech.active) void speech.toggle()
    }
    void auto.toggle()
  }
  const toggleSpeech = () => {
    if (!readAloudSupported) return flash(t('reader.ttsUnsupported'))
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
      .then(() => flash(t('reader.copied')))
      .catch(() => flash(t('reader.copyFailed')))
    setSelection(null)
  }

  const shareSelection = () => {
    const text = selectionRef.current?.text
    if (!text) return
    openQuote(text)
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
    // the language becomes part of a host name, so an odd value from the book's metadata must not get through
    if (lang === 'auto') lang = /^[a-z]{2,3}$/.test(bookLang.current) ? bookLang.current : /\p{Script=Hebrew}/u.test(word) ? 'he' : 'en'
    openDict(word, lang)
  }

  const translateSelection = () => {
    const text = selectionRef.current?.text.trim()
    if (!text) return
    const chosen = settingsRef.current.translateLang
    openTranslate(text, bookLang.current, chosen === 'auto' ? getLocale() : chosen)
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
      toggleBars: () => setUiVisible((v) => !v),
    }
  })

  const editingNote = notes.notes.find((x) => x.id === editingId)
  const bookmarked = !!here && notes.notes.some((n) => n.kind === 'bookmark' && n.cfi === here)
  const navOpen = panel === 'toc' || panel === 'notes'
  const colors = themeColors(settings)
  const shownFraction = dragFraction ?? fraction
  const positionText = (f: number) =>
    pages ? t('a11y.position', { current: pages.current, total: pages.total, pct: Math.round(f * 100) }) : t('a11y.positionNoPages', { pct: Math.round(f * 100) })
  const dismissTapHelp = () => {
    setTapHelp(false)
    try {
      localStorage.setItem(TAP_HELP_KEY, '1')
    } catch {
      /* private mode: the hint shows again next time */
    }
  }
  const commit = () => {
    if (dragFraction !== null) jumpTo(dragFraction, true)
    setDragFraction(null)
  }

  return (
    <div
      className={`reader theme-${settings.theme}${modes.focus ? ' focus' : ''}`}
      dir={isRtl() ? 'rtl' : 'ltr'}
      style={{ ['--bg' as string]: colors.bg, ['--fg' as string]: colors.fg }}
    >
      <div className="view-host" ref={host} role="region" aria-label={t('a11y.book', { title })} style={settings.brightness < 1 ? { filter: `brightness(${settings.brightness})` } : undefined} />

      <div className="sr-only" role="status" aria-live="polite">
        {status === 'ready' ? [chapter, positionText(fraction)].filter(Boolean).join(', ') : ''}
      </div>
      {status === 'loading' && <div className="overlay-msg" role="status"><BookLoader label={t('common.loading')} /></div>}
      {status === 'error' && (
        <div className="overlay-msg error" role="alert">
          <p>{error}</p>
          <button onClick={close}>{t('reader.backToLibrary')}</button>
        </div>
      )}

      <div className={'topbar' + (uiVisible ? '' : ' hidden')} role="toolbar" aria-label={t('a11y.topbar')} inert={!uiVisible}>
        <button onClick={close} aria-label={t('reader.backToLibrary')} title={t('reader.backToLibrary')}>{isRtl() ? '→' : '←'}</button>
        <h1 className="title">{title}</h1>
        <button
          onClick={toggleBookmark}
          aria-label={t('reader.bookmark')}
          aria-pressed={bookmarked}
          title={bookmarked ? t('reader.bookmarkRemove') : t('reader.bookmarkAdd')}
        >
          <Icon d="M6 3h12v18l-6-4-6 4z" filled={bookmarked} />
        </button>
        <button
          onClick={() => setPanel(navOpen ? null : 'toc')}
          aria-label={t('nav.title')}
          aria-expanded={navOpen}
          title={t('reader.navTitle')}
        >
          <Icon d="M4 6h16M4 12h16M4 18h16" />
        </button>
        {!isNativeApp && (
          <button
            onClick={toggleFocus}
            aria-label={t('reader.focus')}
            aria-pressed={modes.focus}
            title={t('reader.focusTitle')}
          >
            <Icon d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </button>
        )}
        <button onClick={() => togglePanel('search')} aria-label={t('reader.search')} title={t('reader.search')}>
          <Icon d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5" />
        </button>
        <button onClick={() => togglePanel('settings')} aria-label={t('settings.title')} title={t('settings.title')}>Aa</button>
      </div>

      <div className={'bottombar' + (uiVisible ? '' : ' hidden')} role="toolbar" aria-label={t('a11y.bottombar')} inert={!uiVisible}>
        <button
          className="play"
          onClick={toggleAuto}
          aria-label={auto.active ? t('reader.autoStop') : t('reader.autoStart')}
          aria-pressed={auto.active}
          title={t('reader.autoTitle')}
        >
          <Icon d={auto.active ? 'M7 5v14M17 5v14' : 'M7 4v16l13-8z'} />
        </button>
        {auto.active && (
          <div className="auto-pace" role="group" aria-label={t('reader.autoPace')}>
            <button onClick={() => auto.adjust(false)} aria-label={t('reader.slower')} title={t('reader.slowerTitle')}>−</button>
            <span title={t('reader.perScreen')}>{auto.secsPerScreen ? t('reader.secsPerScreen', { n: auto.secsPerScreen }) : '…'}</span>
            <button onClick={() => auto.adjust(true)} aria-label={t('reader.faster')} title={t('reader.fasterTitle')}>+</button>
          </div>
        )}
        {speech.active && (
          <div className="auto-pace" role="group" aria-label={t('reader.ttsSpeed')}>
            <button onClick={() => speech.setRate(speech.rate - RATE_STEP)} disabled={speech.rate <= MIN_RATE} aria-label={t('reader.ttsSlower')} title={t('reader.ttsSlower')}>−</button>
            <span>{t('reader.ttsRate', { rate: speech.rate.toFixed(1) })}</span>
            <button onClick={() => speech.setRate(speech.rate + RATE_STEP)} disabled={speech.rate >= MAX_RATE} aria-label={t('reader.ttsFaster')} title={t('reader.ttsFaster')}>+</button>
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
            aria-label={t('reader.position')}
            aria-valuetext={positionText(shownFraction)}
            onChange={(e) => setDragFraction(parseFloat(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
          />
          <div className="label" title={chapter || undefined}>
            {pages ? `${t('reader.pageOf', { current: pages.current, total: pages.total })} · ` : ''}
            {Math.round(shownFraction * 100)}%
            {left ? ` · ${t('reader.timeLeft', { time: formatMinutes(left) })}` : ''}
          </div>
        </div>
        {readAloudSupported && (
          <button
            className="play"
            onClick={toggleSpeech}
            aria-label={speech.active ? t('reader.ttsStop') : t('reader.ttsStart')}
            aria-pressed={speech.active}
            title={t('reader.ttsTitle')}
          >
            <Icon d={speech.active ? 'M6 6h12v12H6z' : 'M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12'} />
          </button>
        )}
      </div>

      {selection && !panel && (
        <div
          className="sel-bar"
          role="toolbar"
          aria-label={t('a11y.selection')}
          style={{
            // always centred on screen; below the selection so the system toolbar (above it) stays clear
            left: '50%',
            top: selection.bottom + 64 < window.innerHeight - 90 ? selection.bottom + 64 : Math.max(selection.y - 120, 8),
          }}
          onPointerDown={(e) => e.preventDefault()}
        >
          {HIGHLIGHT_COLORS.map((c, i) => (
            <button key={c} className="swatch" style={{ background: c }} aria-label={t('reader.highlightColor', { color: COLOR_NAMES[i] ?? '' })} onClick={() => addHighlight(c)} />
          ))}
          <button aria-label={t('reader.addNote')} title={t('reader.note')} onClick={addNote}>✎</button>
          <button aria-label={t('reader.copy')} title={t('reader.copy')} onClick={copySelection}>⧉</button>
          <button aria-label={t('reader.shareQuote')} title={t('reader.shareQuoteTitle')} onClick={shareSelection}>⇪</button>
          <button aria-label={t('reader.lookUp')} title={t('reader.dict')} onClick={lookUp}>📖</button>
          <button aria-label={t('reader.translate')} title={t('reader.translate')} onClick={translateSelection}>🌐</button>
        </div>
      )}
      {(backTo || (hitIdx !== null && hits.length > 0)) && !panel && (
        <div className={'jump-chips' + (uiVisible ? '' : ' low')}>
          {backTo && <button onClick={goBack}>{backTo.page ? t('reader.backToPage', { page: backTo.page }) : t('reader.back')}</button>}
          {hitIdx !== null && hits.length > 0 && (
            <div className="hit-nav" role="group" aria-label={t('reader.hits')}>
              <button onClick={() => stepHit(-1)} aria-label={t('reader.prevHit')} title={t('reader.prevHit')}>{isRtl() ? '›' : '‹'}</button>
              <span>{`${Math.max(hitIdx, 0) + 1} / ${hits.length}`}</span>
              <button onClick={() => stepHit(1)} aria-label={t('reader.nextHit')} title={t('reader.nextHit')}>{isRtl() ? '‹' : '›'}</button>
              <button onClick={() => setHitIdx(null)} aria-label={t('reader.closeHits')} title={t('common.close')}>✕</button>
            </div>
          )}
        </div>
      )}
      {tapHelp && status === 'ready' && (
        <Dialog
          className="tap-help"
          role="dialog"
          aria-modal="true"
          aria-label={t('reader.tapHelp')}
          onClick={dismissTapHelp}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              dismissTapHelp()
            }
          }}
        >
          <div>{t('tap.side')}<br />{t('tap.turn')}</div>
          <div>{t('tap.middle')}<br />{t('tap.menus')}</div>
          <div>{t('tap.side')}<br />{t('tap.turn')}</div>
          <p>{t('tap.continue')}</p>
        </Dialog>
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
              onExport={(format) => void notes.exportNotes(title, format)}
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

      {panel === 'translate' && translation && (
        <ConsentGate service="translate" onClose={() => setPanel(null)}>
          <TranslatePanel text={translation.text} source={translation.source} target={translation.target} onClose={() => setPanel(null)} />
        </ConsentGate>
      )}
      {panel === 'dict' && dict && (
        <DictPanel
          word={dict.word}
          lang={dict.lang}
          offline={settings.dictLang === 'auto'}
          onFound={(text) => saveWord(dict.word, dict.lang, text, id).catch(console.error)}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === 'edit' && editingNote && (
        <EditNotePanel
          note={editingNote}
          onUpdate={(patch) => notes.update(editingNote.id, patch)}
          onRemove={() => {
            notes.remove(editingNote.id)
            setPanel(null)
          }}
          onShare={() => openQuote(editingNote.text, editingNote.note)}
          onClose={closePanel}
        />
      )}

      {panel === 'quote' && quote && (
        <QuoteShareDialog
          text={quote.text}
          note={quote.note}
          title={title}
          colors={colors}
          fontFamily={settings.fontFamily}
          onClose={closePanel}
          flash={flash}
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
        <SettingsPanel settings={settings} set={set} bump={bump} customFont={customFont} onAllSettings={onSettings}>
          <ZoomSection viewRef={viewRef} />
          <ViewModesSection
            modes={modes}
            setMode={setMode}
            flow={settings.flow}
            eyeStatus={eye.status}
            onRecalibrate={eye.recalibrate}
          />
          {readAloudSupported && (
            <ReadAloudSection lang={language} rate={speech.rate} reading={speech.active} />
          )}
        </SettingsPanel>
      )}
    </div>
  )
}
