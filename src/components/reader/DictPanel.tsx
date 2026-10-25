import { useEffect, useState, type ReactNode } from 'react'
import { lookUpWord, wiktionaryUrl } from '../../lib/dictionary'
import { lookUpOfflineEntry, type OfflineEntry } from '../../lib/offlineDict'
import { useLatest } from '../../hooks/useLatest'
import { ConsentGate } from './ConsentGate'
import { Panel } from './shared'
import { t } from '../../i18n'

type Outcome = { state: 'found'; text: string } | { state: 'missing' } | { state: 'failed' }

const RELATION_LABEL = { s: 'dict.synonyms', a: 'dict.antonyms', r: 'dict.related', d: 'dict.derived' } as const

/**
 * `offline`: try the dictionary downloaded to the device first (it needs no network and no permission); the online one,
 * which needs the reader's permission to send the word, answers only when the device has no entry.
 * `onFound` gets the entry once it is on screen, with the word it is for, so the app can keep the word for later review.
 * The synonyms, antonyms and related words of an offline entry can be tapped to look them up in turn, and "back" returns.
 */
export function DictPanel({ word, lang, offline, onFound, onClose }: { word: string; lang: string; offline: boolean; onFound: (text: string, word: string) => void; onClose: () => void }) {
  // the words tapped since the panel opened on `word`; a new `word` starts afresh
  const [trail, setTrail] = useState<{ from: string; words: string[] }>({ from: word, words: [] })
  const path = trail.from === word ? trail.words : []
  const current = path.at(-1) ?? word
  const go = (words: string[]) => setTrail({ from: word, words })
  const back = path.length ? () => go(path.slice(0, -1)) : undefined
  return <DictEntry key={current} word={current} lang={lang} offline={offline} onFound={onFound} onClose={onClose} onOpen={(w) => go([...path, w])} onBack={back} />
}

function DictEntry({
  word,
  lang,
  offline,
  onFound,
  onClose,
  onOpen,
  onBack,
}: {
  word: string
  lang: string
  offline: boolean
  onFound: (text: string, word: string) => void
  onClose: () => void
  onOpen: (word: string) => void
  onBack?: () => void
}) {
  const found = useLatest(onFound)
  const request = `${lang}:${word}`
  const [local, setLocal] = useState<{ request: string; entry: OfflineEntry | null } | null>(null)
  // an answer for an older request counts as still loading
  const answer = !offline ? { entry: null } : local?.request === request ? local : null

  useEffect(() => {
    if (!offline) return
    let stale = false
    const finish = (entry: OfflineEntry | null) => {
      if (stale) return
      setLocal({ request, entry })
      if (entry) found.current(entry.text, word)
    }
    lookUpOfflineEntry(lang, word).then(finish, () => finish(null))
    return () => {
      stale = true
    }
  }, [word, lang, offline, request, found])

  const backButton = onBack && <button onClick={onBack}>{t('dict.back')}</button>

  if (!answer)
    return (
      <Panel label={t('dict.title', { word })} className="dict">
        <h3 lang={lang}>{word}</h3>
        <p className="muted" role="status">{t('common.loading')}</p>
      </Panel>
    )
  if (answer.entry)
    return (
      <Panel label={t('dict.title', { word })} className="dict">
        <h3 lang={lang}>{word}</h3>
        <div className="dict-text" dir="auto">
          {answer.entry.text}
          {answer.entry.related.map(({ kind, words }) => (
            <div key={kind} className="dict-related">
              <strong>{t(RELATION_LABEL[kind])}</strong>
              {words.map((w) => (
                <button key={w} lang={lang} onClick={() => onOpen(w)}>
                  {w}
                </button>
              ))}
            </div>
          ))}
        </div>
        <small className="muted">{t('dict.offlineSource')}</small>
        <div className="row">
          {backButton}
          <a href={wiktionaryUrl(lang === 'ar' ? 'en' : lang, word)} target="_blank" rel="noopener noreferrer">
            {t('dict.openWiktionary')}
          </a>
          <span style={{ flex: 1 }} />
          <button className="primary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </Panel>
    )
  return (
    <ConsentGate service="dict" onClose={onClose}>
      <OnlineDictPanel word={word} lang={lang} onFound={onFound} onClose={onClose} backButton={backButton} />
    </ConsentGate>
  )
}

function OnlineDictPanel({
  word,
  lang,
  onFound,
  onClose,
  backButton,
}: {
  word: string
  lang: string
  onFound: (text: string, word: string) => void
  onClose: () => void
  backButton?: ReactNode
}) {
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
        if (text && !ctl.signal.aborted) found.current(text, word)
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
        {backButton}
        <a href={wiktionaryUrl(lang, word)} target="_blank" rel="noopener noreferrer">
          {t('dict.openWiktionary')}
        </a>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={onClose}>{t('common.close')}</button>
      </div>
    </Panel>
  )
}
