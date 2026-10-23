import { useEffect, useState } from 'react'
import { lookUpWord, wiktionaryUrl } from '../../lib/dictionary'
import { lookUpOffline } from '../../lib/offlineDict'
import { useLatest } from '../../hooks/useLatest'
import { ConsentGate } from './ConsentGate'
import { Panel } from './shared'
import { t } from '../../i18n'

type Outcome = { state: 'found'; text: string } | { state: 'missing' } | { state: 'failed' }

/**
 * `offline`: try the dictionary downloaded to the device first (it needs no network and no permission); the online one,
 * which needs the reader's permission to send the word, answers only when the device has no entry.
 * `onFound` gets the entry once it is on screen, so the app can keep the word for later review.
 */
export function DictPanel({ word, lang, offline, onFound, onClose }: { word: string; lang: string; offline: boolean; onFound: (text: string) => void; onClose: () => void }) {
  const found = useLatest(onFound)
  const request = `${lang}:${word}`
  const [local, setLocal] = useState<{ request: string; text: string | null } | null>(null)
  // an answer for an older request counts as still loading
  const answer = !offline ? { text: null } : local?.request === request ? local : null

  useEffect(() => {
    if (!offline) return
    let stale = false
    const finish = (text: string | null) => {
      if (stale) return
      setLocal({ request, text })
      if (text) found.current(text)
    }
    lookUpOffline(lang, word).then(finish, () => finish(null))
    return () => {
      stale = true
    }
  }, [word, lang, offline, request, found])

  if (!answer)
    return (
      <Panel label={t('dict.title', { word })} className="dict">
        <h3 lang={lang}>{word}</h3>
        <p className="muted" role="status">{t('common.loading')}</p>
      </Panel>
    )
  if (answer.text)
    return (
      <Panel label={t('dict.title', { word })} className="dict">
        <h3 lang={lang}>{word}</h3>
        <div className="dict-text" dir="auto">{answer.text}</div>
        <small className="muted">{t('dict.offlineSource')}</small>
        <div className="row">
          <a href={wiktionaryUrl('en', word)} target="_blank" rel="noopener noreferrer">
            {t('dict.openWiktionary')}
          </a>
          <span style={{ flex: 1 }} />
          <button className="primary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </Panel>
    )
  return (
    <ConsentGate service="dict" onClose={onClose}>
      <OnlineDictPanel word={word} lang={lang} onFound={onFound} onClose={onClose} />
    </ConsentGate>
  )
}

function OnlineDictPanel({ word, lang, onFound, onClose }: { word: string; lang: string; onFound: (text: string) => void; onClose: () => void }) {
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
