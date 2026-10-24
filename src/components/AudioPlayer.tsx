import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, Panel, Seg } from './reader/shared'
import { HIGHLIGHT_COLORS } from './reader/colors'
import { useBackGesture } from '../hooks/useBackGesture'
import { useFlash } from '../hooks/useFlash'
import { useLatest } from '../hooks/useLatest'
import { getBook, getNotes, newId, saveNotes, updateProgress, type Annotation, type BookRecord } from '../lib/db'
import {
  MAX_SPEED,
  MIN_SPEED,
  SPEEDS,
  chapterAt,
  clampSpeed,
  formatTime,
  locTime,
  timeLoc,
  type AudioChapter,
} from '../lib/audioBook'
import { loadSettings, themeColors } from '../lib/settings'
import { isRtl, localeTag, t } from '../i18n'
import './audioPlayer.css'
import { BookLoader } from './BookLoader'

const SPEED_KEY = 'reader:audioSpeed'
const SKIP_BACK = 15
const SKIP_FWD = 30
/** position is written to storage this often while playing */
const SAVE_MS = 5000
/** after resuming, rewind a little so the listener catches the thread */
const RESUME_REWIND = 3
const SLEEP_MINUTES = [15, 30, 45, 60] as const

const loadSpeed = () => {
  try {
    return clampSpeed(Number(localStorage.getItem(SPEED_KEY)) || 1)
  } catch {
    return 1
  }
}

type Sleep = { kind: 'minutes'; until: number } | { kind: 'chapter' }
type PanelName = 'chapters' | 'marks' | 'speed' | 'sleep'

export default function AudioPlayer({ id, onClose }: { id: string; onClose: () => void }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [book, setBook] = useState<BookRecord>()
  const [failed, setFailed] = useState(false)
  const [src, setSrc] = useState<string>()
  const [cover, setCover] = useState<string>()
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(loadSpeed)
  const [panel, setPanel] = useState<PanelName | null>(null)
  const [marks, setMarks] = useState<Annotation[]>([])
  const [sleep, setSleep] = useState<Sleep | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const { message: toast, flash } = useFlash()
  const colors = themeColors(loadSettings())

  const chapters: AudioChapter[] = useMemo(() => book?.audio?.chapters ?? [], [book])
  const total = duration || book?.audio?.duration || 0
  const startAt = useRef(0)
  const lastSaved = useRef(0)

  useEffect(() => {
    let alive = true
    getBook(id).then(
      async (b) => {
        if (!alive) return
        if (!b) return setFailed(true)
        const saved = locTime(b.cfi)
        startAt.current = saved === undefined ? 0 : Math.max(0, saved - RESUME_REWIND)
        setTime(startAt.current)
        setMarks(await getNotes(id))
        if (alive) setBook(b)
      },
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [id])

  useEffect(() => {
    if (!book) return
    const u = URL.createObjectURL(book.file)
    // oxlint-disable-next-line react/set-state-in-effect -- syncs an object URL, an external resource
    setSrc(u)
    return () => URL.revokeObjectURL(u)
  }, [book])
  useEffect(() => {
    if (!book?.cover) return
    const u = URL.createObjectURL(book.cover)
    // oxlint-disable-next-line react/set-state-in-effect -- syncs an object URL, an external resource
    setCover(u)
    return () => URL.revokeObjectURL(u)
  }, [book])

  const save = useCallback(() => {
    const el = audio.current
    if (!el || !el.duration || !Number.isFinite(el.duration)) return
    lastSaved.current = Date.now()
    void updateProgress(id, timeLoc(el.currentTime), el.currentTime / el.duration)
  }, [id])
  const saveRef = useLatest(save)

  // keep the position when leaving: on close (below), when the tab is hidden, and every few seconds while playing
  useEffect(() => {
    const flush = () => saveRef.current()
    const onVis = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [saveRef])
  // saved here, not on unmount: by then React has already detached the <audio> element
  const close = () => {
    save()
    onClose()
  }
  // the phone's back swipe: closes an open panel, else goes back to the library
  useBackGesture(() => {
    if (panel) setPanel(null)
    else close()
  }, 1)

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed
    try {
      localStorage.setItem(SPEED_KEY, String(speed))
    } catch {
      /* the speed just isn't remembered */
    }
  }, [speed, src])

  const seek = useCallback((t: number) => {
    const el = audio.current
    if (!el) return
    const max = Number.isFinite(el.duration) ? el.duration : Infinity
    el.currentTime = Math.min(max, Math.max(0, t))
    setTime(el.currentTime)
  }, [])
  const skip = useCallback((d: number) => seek((audio.current?.currentTime ?? 0) + d), [seek])
  const toggle = useCallback(() => {
    const el = audio.current
    if (!el) return
    if (el.paused) el.play().catch((e) => console.warn('play blocked', e))
    else el.pause()
  }, [])

  const cur = chapterAt(chapters, time)
  const goChapter = useCallback(
    (dir: 1 | -1) => {
      const now = audio.current?.currentTime ?? 0
      const i = chapterAt(chapters, now)
      // "previous" first returns to the start of the current chapter
      const target = dir === 1 ? chapters[i + 1] : now - (chapters[i]?.start ?? 0) > 3 ? chapters[i] : chapters[i - 1]
      if (target) seek(target.start)
      else if (dir === -1) seek(0)
    },
    [chapters, seek],
  )

  // sleep timer: pauses after N minutes (the end-of-chapter variant is checked on every time update)
  useEffect(() => {
    if (sleep?.kind !== 'minutes' || !playing) return
    const timer = window.setTimeout(() => {
      audio.current?.pause()
      setSleep(null)
      flash(t('audio.sleepStopped'))
    }, Math.max(0, sleep.until - Date.now()))
    return () => window.clearTimeout(timer)
  }, [sleep, playing, flash])

  const commitMarks = (next: Annotation[]) => {
    setMarks(next)
    void saveNotes(id, next)
  }
  const addMark = () => {
    const at = audio.current?.currentTime ?? time
    const ch = chapters[chapterAt(chapters, at)]
    const label = ch ? `${formatTime(at)} · ${ch.title}` : formatTime(at)
    commitMarks([
      ...marks,
      { id: newId(), kind: 'bookmark', cfi: timeLoc(at), text: label, color: HIGHLIGHT_COLORS[0] ?? '', createdAt: Date.now() },
    ])
    flash(t('audio.markAdded'))
  }
  const bookmarks = marks
    .filter((m) => m.kind === 'bookmark' && locTime(m.cfi) !== undefined)
    .sort((a, b) => (locTime(a.cfi) ?? 0) - (locTime(b.cfi) ?? 0))

  // lock-screen / headset controls
  const title = book?.title ?? ''
  const author = book?.author ?? ''
  useEffect(() => {
    if (!('mediaSession' in navigator) || !title) return
    const ms = navigator.mediaSession
    ms.metadata = new MediaMetadata({ title, artist: author, artwork: cover ? [{ src: cover }] : [] })
    const on = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(a, h)
      } catch {
        /* action not supported here */
      }
    }
    on('play', toggle)
    on('pause', toggle)
    on('seekbackward', () => skip(-SKIP_BACK))
    on('seekforward', () => skip(SKIP_FWD))
    on('previoustrack', () => goChapter(-1))
    on('nexttrack', () => goChapter(1))
    return () => {
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack'] as const) on(a, null)
    }
  }, [title, author, cover, toggle, skip, goChapter])

  const onKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLInputElement
    if (el.tagName === 'INPUT' || el.tagName === 'BUTTON') return // the focused control keeps its own keys
    if (e.key === ' ') toggle()
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') skip(e.key === 'ArrowRight' ? -SKIP_BACK : SKIP_FWD)
    else if (e.key === 'b') addMark()
    else if (e.key === 'Escape') {
      if (panel) setPanel(null)
      else close()
    } else return
    e.preventDefault()
  }

  const shown = drag ?? time
  const left = total ? Math.max(0, total - shown) / speed : 0
  const togglePanel = (p: PanelName) => setPanel(panel === p ? null : p)
  const commitDrag = () => {
    if (drag !== null) seek(drag)
    setDrag(null)
  }

  return (
    <div className="reader audio" dir={isRtl() ? 'rtl' : 'ltr'} style={{ ['--bg' as string]: colors.bg, ['--fg' as string]: colors.fg }} onKeyDown={onKey}>
      <div className="topbar">
        <button onClick={close} aria-label={t('reader.backToLibrary')}><Icon d={isRtl() ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} /></button>
        <span className="title">{title}</span>
        <button onClick={() => togglePanel('marks')} aria-label={t('audio.marks')} aria-pressed={panel === 'marks'}>🔖</button>
      </div>

      {failed && (
        <div className="overlay-msg error" role="alert">
          <p>{t('audio.openFailed')}</p>
          <button onClick={close}>{t('reader.backToLibrary')}</button>
        </div>
      )}
      {!book && !failed && <div className="overlay-msg" role="status"><BookLoader label={t('common.loading')} /></div>}

      {book && (
        <main className="audio-main">
          {cover ? <img className="audio-cover" src={cover} alt="" /> : <div className="audio-cover placeholder">{title}</div>}
          <h2>{title}</h2>
          {author && <p className="muted">{author}</p>}
          {chapters.length > 0 && (
            <button className="chapter-btn" onClick={() => togglePanel('chapters')} aria-label={t('audio.chapters')}>
              {chapters[cur]?.title ?? t('audio.chapters')}
            </button>
          )}
        </main>
      )}

      {src && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => {
            const el = e.currentTarget
            if (Number.isFinite(el.duration)) setDuration(el.duration)
            if (startAt.current) el.currentTime = startAt.current
            el.playbackRate = speed
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget
            setTime(el.currentTime)
            if (Date.now() - lastSaved.current > SAVE_MS) save()
            // "end of chapter" sleep: stop as soon as the next chapter begins
            if (sleep?.kind === 'chapter') {
              const next = chapters[chapterAt(chapters, el.currentTime) + 1]
              if (next && el.currentTime >= next.start - 0.3) {
                el.pause()
                setSleep(null)
                flash(t('audio.chapterStopped'))
              }
            }
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false)
            save()
          }}
          onEnded={() => {
            setPlaying(false)
            save()
          }}
          onError={() => setFailed(true)}
        />
      )}

      {book && (
        <div className="audio-controls">
          <div className="audio-seek">
            <input
              type="range"
              min={0}
              max={total || 1}
              step={1}
              value={Math.min(shown, total || 1)}
              aria-label={t('audio.position')}
              onChange={(e) => setDrag(Number(e.target.value))}
              onPointerUp={commitDrag}
              onKeyUp={commitDrag}
              onBlur={commitDrag}
            />
            <div className="audio-times" dir="ltr">
              <span>{formatTime(shown)}</span>
              <span>{total ? `-${formatTime(left)}` : ''}</span>
              <span>{total ? formatTime(total) : ''}</span>
            </div>
          </div>
          <div className="audio-buttons">
            <button onClick={() => goChapter(-1)} disabled={!chapters.length} aria-label={t('audio.prevChapter')}>⏮</button>
            <button onClick={() => skip(-SKIP_BACK)} aria-label={t('audio.skipBack', { n: SKIP_BACK })}>−{SKIP_BACK}</button>
            <button className="primary play-big" onClick={toggle} aria-label={playing ? t('audio.pause') : t('audio.play')}>
              <Icon d={playing ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M6 4l14 8-14 8z'} filled />
            </button>
            <button onClick={() => skip(SKIP_FWD)} aria-label={t('audio.skipFwd', { n: SKIP_FWD })}>+{SKIP_FWD}</button>
            <button onClick={() => goChapter(1)} disabled={!chapters.length} aria-label={t('audio.nextChapter')}>⏭</button>
          </div>
          <div className="audio-extra">
            <button onClick={() => togglePanel('speed')} aria-pressed={panel === 'speed'} aria-label={t('audio.speed')}>
              <span dir="ltr">{speed}×</span>
            </button>
            <button onClick={addMark}>🔖 {t('audio.markHere')}</button>
            <button onClick={() => togglePanel('sleep')} aria-pressed={panel === 'sleep' || !!sleep} aria-label={t('audio.sleep')}>
              😴{sleep?.kind === 'chapter' ? ' ' + t('audio.chapterShort') : sleep ? ' ✓' : ''}
            </button>
          </div>
        </div>
      )}

      {panel === 'speed' && (
        <Panel label={t('audio.speed')} className="audio-panel">
          <h3>{t('audio.speed')}</h3>
          <div className="speed-row">
            <button onClick={() => setSpeed(clampSpeed(speed - 0.05))} disabled={speed <= MIN_SPEED} aria-label={t('audio.slower')}>−</button>
            <input
              type="range"
              min={MIN_SPEED}
              max={MAX_SPEED}
              step={0.05}
              value={speed}
              aria-label={t('audio.speed')}
              onChange={(e) => setSpeed(clampSpeed(Number(e.target.value)))}
            />
            <button onClick={() => setSpeed(clampSpeed(speed + 0.05))} disabled={speed >= MAX_SPEED} aria-label={t('audio.faster')}>+</button>
          </div>
          <p className="speed-value" dir="ltr">{speed.toFixed(2)}×</p>
          <div className="speed-presets">
            {SPEEDS.map((s) => (
              <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>
                <span dir="ltr">{s}×</span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      {panel === 'sleep' && (
        <Panel label={t('audio.sleep')} className="audio-panel">
          <h3>{t('audio.sleep')}</h3>
          <Seg
            value={sleep?.kind === 'chapter' ? 'chapter' : sleep ? 'minutes' : 'off'}
            onChange={(v) => {
              if (v === 'off') setSleep(null)
              else if (v === 'chapter') setSleep({ kind: 'chapter' })
            }}
            options={[
              ['off', t('audio.sleepOff')],
              ['chapter', t('audio.sleepChapter')],
              [
                'minutes',
                sleep?.kind === 'minutes'
                  ? t('audio.sleepUntil', { time: new Date(sleep.until).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' }) })
                  : t('audio.sleepMinutes'),
              ],
            ]}
          />
          <div className="speed-presets">
            {SLEEP_MINUTES.map((m) => (
              <button
                key={m}
                onClick={() => {
                  setSleep({ kind: 'minutes', until: Date.now() + m * 60_000 })
                  setPanel(null)
                }}
              >
                {t('audio.minutesShort', { n: m })}
              </button>
            ))}
          </div>
        </Panel>
      )}

      {panel === 'chapters' && (
        <Panel label={t('audio.chapters')} className="audio-panel">
          <h3>{t('audio.chapters')}</h3>
          <ul className="notes">
            {chapters.map((c, i) => (
              <li key={i}>
                <button
                  className="note-main"
                  aria-current={i === cur}
                  onClick={() => {
                    seek(c.start)
                    setPanel(null)
                  }}
                >
                  <span style={{ fontWeight: i === cur ? 700 : 400 }}>{c.title}</span>
                  <small dir="ltr">{formatTime(c.start)}</small>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {panel === 'marks' && (
        <Panel label={t('audio.marks')} className="audio-panel">
          <h3>{t('audio.marks')}</h3>
          {bookmarks.length === 0 ? (
            <p className="muted">{t('audio.noMarks')}</p>
          ) : (
            <ul className="notes">
              {bookmarks.map((m) => (
                <li key={m.id}>
                  <button
                    className="note-main"
                    onClick={() => {
                      seek(locTime(m.cfi) ?? 0)
                      setPanel(null)
                    }}
                  >
                    <span className="note-kind">🔖</span>
                    <span>{m.text}</span>
                  </button>
                  <button aria-label={t('common.delete')} onClick={() => commitMarks(marks.filter((x) => x.id !== m.id))}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
