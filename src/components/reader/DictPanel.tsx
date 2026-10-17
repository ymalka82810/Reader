import { useEffect, useState } from 'react'
import { lookUpWord, wiktionaryUrl } from '../../lib/dictionary'
import { useLatest } from '../../hooks/useLatest'
import { Panel } from './shared'
import { t } from '../../i18n'

type Outcome = { state: 'found'; text: string } | { state: 'missing' } | { state: 'failed' }

/** `onFound` gets the entry once it is on screen, so the app can keep the word for later review */
export function DictPanel({ word, lang, onFound, onClose }: { word: string; lang: string; onFound: (text: string) => void; onClose: () => void }) {
  const found = useLatest(onFound)
  const [attempt, setAttempt] = useState(0)
  const request = `${lang}:${word}:${attempt}`
  const [done, setDone] = useState<{ request: string; outcome: Outcome } | null>(null)
  // an answer for an older request counts as still loading
  const result = done?.request === request ? done.outcome : null

  useEffect(() => {
    const ctl = new AbortController()
    const finish = (outcome: Outcome) => setDone({ request, outcome })
    lookUpWord(lang, word, ctl.signal).then(
      (text) => {
        finish(text ? { state: 'found', text } : { state: 'missing' })
        if (text && !ctl.signal.aborted) found.current(text)
      },
      () => {
        if (!ctl.signal.aborted) finish({ state: 'failed' })
      },
    )
    return () => ctl.abort()
  }, [word, lang, request, found])

  return (
    <Panel label={t('dict.title', { word })} className="dict">
      <h3 lang={lang}>{word}</h3>
      {!result && <p className="muted" role="status">{t('common.loading')}</p>}
      {result?.state === 'found' && (
        <div className="dict-text" lang={lang} dir="auto">
          {result.text}
        </div>
      )}
      {result?.state === 'missing' && <p className="muted">{t('dict.missing')}</p>}
      {result?.state === 'failed' && (
        <p className="muted">
          {t('dict.failed')}{' '}
          <button onClick={() => setAttempt((n) => n + 1)}>{t('dict.retry')}</button>
        </p>
      )}
      <div className="row">
        <a href={wiktionaryUrl(lang, word)} target="_blank" rel="noopener noreferrer">
          {t('dict.openWiktionary')}
        </a>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={onClose}>{t('common.close')}</button>
      </div>
    </Panel>
  )
}
