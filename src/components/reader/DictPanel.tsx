import { useEffect, useState } from 'react'
import { lookUpWord, wiktionaryUrl } from '../../lib/dictionary'
import { Panel } from './shared'

type Outcome = { state: 'found'; text: string } | { state: 'missing' } | { state: 'failed' }

export function DictPanel({ word, lang, onClose }: { word: string; lang: string; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0)
  const request = `${lang}:${word}:${attempt}`
  const [done, setDone] = useState<{ request: string; outcome: Outcome } | null>(null)
  // an answer for an older request counts as still loading
  const result = done?.request === request ? done.outcome : null

  useEffect(() => {
    const ctl = new AbortController()
    const finish = (outcome: Outcome) => setDone({ request, outcome })
    lookUpWord(lang, word, ctl.signal).then(
      (text) => finish(text ? { state: 'found', text } : { state: 'missing' }),
      () => {
        if (!ctl.signal.aborted) finish({ state: 'failed' })
      },
    )
    return () => ctl.abort()
  }, [word, lang, request])

  return (
    <Panel label={`מילון: ${word}`} className="dict">
      <h3 lang={lang}>{word}</h3>
      {!result && <p className="muted" role="status">טוען…</p>}
      {result?.state === 'found' && (
        <div className="dict-text" lang={lang} dir="auto">
          {result.text}
        </div>
      )}
      {result?.state === 'missing' && <p className="muted">לא נמצא ערך במילון.</p>}
      {result?.state === 'failed' && (
        <p className="muted">
          לא ניתן להגיע למילון (אין חיבור לרשת?).{' '}
          <button onClick={() => setAttempt((n) => n + 1)}>נסה שוב</button>
        </p>
      )}
      <div className="row">
        <a href={wiktionaryUrl(lang, word)} target="_blank" rel="noopener noreferrer">
          פתח בוויקימילון
        </a>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={onClose}>סגור</button>
      </div>
    </Panel>
  )
}
