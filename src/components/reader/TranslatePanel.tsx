import { useEffect, useState } from 'react'
import { translateText, MAX_TRANSLATE_CHARS } from '../../lib/translate'
import { Panel } from './shared'
import { t } from '../../i18n'

type Outcome = { state: 'done'; text: string } | { state: 'failed' }

export function TranslatePanel({
  text,
  source,
  target,
  onClose,
}: {
  text: string
  source: string
  target: string
  onClose: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const request = `${source}>${target}:${text}:${attempt}`
  const [done, setDone] = useState<{ request: string; outcome: Outcome } | null>(null)
  // an answer for an older request counts as still loading
  const result = done?.request === request ? done.outcome : null

  useEffect(() => {
    const ctl = new AbortController()
    translateText(text, source, target, ctl.signal).then(
      (out) => setDone({ request, outcome: { state: 'done', text: out } }),
      () => {
        if (!ctl.signal.aborted) setDone({ request, outcome: { state: 'failed' } })
      },
    )
    return () => ctl.abort()
  }, [text, source, target, request])

  return (
    <Panel label={t('translate.title')} className="dict">
      <p className="muted" lang={source || undefined} dir="auto">
        {text.length > 300 ? text.slice(0, 300).trimEnd() + '…' : text}
      </p>
      {!result && <p className="muted" role="status">{t('common.loading')}</p>}
      {result?.state === 'done' && (
        <div className="dict-text" lang={target} dir="auto">
          {result.text}
        </div>
      )}
      {result?.state === 'failed' && (
        <p className="muted">
          {t('translate.failed')}{' '}
          <button onClick={() => setAttempt((n) => n + 1)}>{t('dict.retry')}</button>
        </p>
      )}
      {text.length > MAX_TRANSLATE_CHARS && <p className="muted">{t('translate.truncated', { n: MAX_TRANSLATE_CHARS })}</p>}
      <div className="row">
        <span className="muted">{t('translate.credit')}</span>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={onClose}>{t('common.close')}</button>
      </div>
    </Panel>
  )
}
