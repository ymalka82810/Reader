import { useEffect, useState } from 'react'
import { Select } from '../Select'
import { failureOf, languageName, loadVoice, sampleText, saveVoice, speechEngine, voicesFor, type Voice } from '../../lib/speech'
import { t } from '../../i18n'
import './viewModes.css'

/** the voice that reads this book's language aloud, with a sample to hear it first */
export function ReadAloudSection({ lang, rate, reading }: {
  /** the book's language, '' when unknown */
  lang: string
  rate: number
  /** the book is being read aloud right now, so a sample would cut in */
  reading: boolean
}) {
  const [voices, setVoices] = useState<Voice[] | null>(null)
  const [voice, setVoice] = useState(() => loadVoice(lang))
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    speechEngine?.voices().then(
      (all) => alive && setVoices(voicesFor(all, lang)),
      () => alive && setVoices([]),
    )
    return () => {
      alive = false
    }
  }, [lang])

  if (!speechEngine) return null
  const engine = speechEngine
  // a voice that was uninstalled since falls back to the default
  const chosen = voices?.some((v) => v.id === voice) ? voice : ''
  const choose = (id: string) => {
    setVoice(id)
    saveVoice(lang, id)
  }
  const sample = () => {
    setNote('')
    engine.cancel()
    engine.speak(sampleText(lang), { rate, lang: lang || undefined, voice: chosen || undefined }).catch((e) => {
      if (failureOf(e) === 'no-voice') setNote(t('reader.ttsNoVoice'))
    })
  }

  return (
    <fieldset className="view-modes">
      <legend>{t('tts.title')}</legend>
      <div className="mode-row">
        <span>{lang ? t('tts.voice', { lang: languageName(lang) }) : t('tts.voiceAny')}</span>
        {voices === null ? (
          <small className="muted">{t('tts.loading')}</small>
        ) : (
          <Select<string>
            value={chosen}
            onChange={choose}
            label={lang ? t('tts.voice', { lang: languageName(lang) }) : t('tts.voiceAny')}
            options={[['', t('tts.default')], ...voices.map((v): [string, string] => [v.id, v.label])]}
          />
        )}
        {voices?.length === 0 && <small className="muted">{t('tts.noVoices')}</small>}
      </div>
      <button onClick={sample} disabled={reading}>{t('tts.try')}</button>
      {note && <small className="muted" role="status">{note}</small>}
    </fieldset>
  )
}
