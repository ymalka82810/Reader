import { useEffect, useRef, useState } from 'react'
import { download } from '../../lib/download'
import { renderQuoteImage } from '../../lib/quoteImage'
import { Panel, Seg } from './shared'
import './quoteShare.css'

const PREF_KEY = 'reader:quoteCredit'

type Mode = 'book' | 'speaker'
interface Pref {
  mode: Mode
  speaker: string
}

function loadPref(): Pref {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<Pref>
    return { mode: p.mode === 'speaker' ? 'speaker' : 'book', speaker: typeof p.speaker === 'string' ? p.speaker : '' }
  } catch {
    return { mode: 'book', speaker: '' }
  }
}

function savePref(p: Pref) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p))
  } catch {
    /* private mode: the choice is not remembered */
  }
}

const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'ציטוט'}.png`

/** share a passage as an image (in quotation marks, credited to the book or to a speaker) or as plain text */
export function QuoteShareDialog({
  text,
  note,
  title,
  colors,
  fontFamily,
  onClose,
  flash,
}: {
  text: string
  /** the reader's own note on the passage, sent along with the text */
  note?: string
  title: string
  colors: { bg: string; fg: string }
  fontFamily: string
  onClose: () => void
  flash: (msg: string) => void
}) {
  const { bg, fg } = colors
  const [pref, setPref] = useState(loadPref)
  const [bookName, setBookName] = useState(title)
  const credit = pref.mode === 'book' ? bookName : pref.speaker
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState('')
  const lastUrl = useRef('')

  useEffect(() => {
    let stale = false
    renderQuoteImage({ text, credit, colors: { bg, fg }, fontFamily })
      .then((b) => {
        if (stale) return
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current)
        lastUrl.current = URL.createObjectURL(b)
        setBlob(b)
        setUrl(lastUrl.current)
      })
      .catch((e) => {
        console.error(e)
        if (!stale) flash('יצירת התמונה נכשלה')
      })
    return () => {
      stale = true
    }
  }, [text, credit, bg, fg, fontFamily, flash])
  useEffect(() => () => {
    if (lastUrl.current) URL.revokeObjectURL(lastUrl.current)
  }, [])

  const update = (patch: Partial<Pref>) =>
    setPref((p) => {
      const next = { ...p, ...patch }
      savePref(next)
      return next
    })
  const edit = (v: string) => (pref.mode === 'book' ? setBookName(v) : update({ speaker: v }))

  const shareImage = () => {
    if (!blob) return
    const file = new File([blob], fileName(title), { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file] }).then(onClose, () => {})
    } else {
      download(blob, file.name)
      flash('התמונה נשמרה')
    }
  }

  /** hands the passage to whatever app the reader picks, e.g. a notes app */
  const shareText = () => {
    const lines = [`“${text.trim()}”`]
    if (credit.trim()) lines.push(`— ${credit.trim()}`)
    if (note) lines.push('', note)
    navigator.share({ text: lines.join('\n'), title }).then(onClose, () => {})
  }

  return (
    <Panel label="שיתוף ציטוט" className="quote-share">
      {url && <img className="quote-preview" src={url} alt="תצוגה מקדימה של הציטוט" />}
      <Seg<Mode>
        value={pref.mode}
        onChange={(mode) => update({ mode })}
        options={[
          ['book', 'שם הספר'],
          ['speaker', 'שם הדובר'],
        ]}
      />
      <input
        type="text"
        value={credit}
        onChange={(e) => edit(e.target.value)}
        placeholder={pref.mode === 'book' ? 'שם הספר' : 'שם הדובר (ריק = בלי שם)'}
        aria-label={pref.mode === 'book' ? 'שם הספר' : 'שם הדובר'}
      />
      <div className="row">
        <button className="primary" onClick={shareImage} disabled={!blob}>
          {typeof navigator.canShare === 'function' ? 'שתף כתמונה' : 'שמור תמונה'}
        </button>
        {typeof navigator.share === 'function' && <button onClick={shareText}>שלח כטקסט / להערות</button>}
        <span style={{ flex: 1 }} />
        <button onClick={onClose}>סגור</button>
      </div>
    </Panel>
  )
}
