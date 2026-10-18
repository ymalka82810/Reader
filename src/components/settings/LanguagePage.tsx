import { useState } from 'react'
import { changeLocale, getLocale, LOCALES, t } from '../../i18n'
import { setConsent } from '../../lib/consent'
import { DICT_LANGS, type Settings } from '../../lib/settings'
import type { SetSetting } from '../../hooks/useAppSettings'
import { Select } from '../Select'
import { Seg } from '../reader/shared'
import { Row, Section } from './parts'

export function LanguagePage({ settings, set }: { settings: Settings; set: SetSetting }) {
  const [consentReset, setConsentReset] = useState(false)
  const langs = DICT_LANGS.map(([code, name]): [string, string] => [code, name])
  return (
    <>
      <Section title={t('prefs.ifaceLang')}>
        <Seg label={t('prefs.ifaceLang')} value={getLocale()} onChange={changeLocale} options={LOCALES} />
        <small className="muted">{t('prefs.ifaceLangNote')}</small>
      </Section>
      <Section title={t('prefs.lookup')}>
        <Row label={t('settings.dictLang')}>
          <Select
            label={t('settings.dictLang')}
            value={settings.dictLang}
            onChange={(v) => set('dictLang', v)}
            options={[['auto', t('settings.dictAuto')], ...langs]}
          />
        </Row>
        <Row label={t('settings.translateLang')}>
          <Select
            label={t('settings.translateLang')}
            value={settings.translateLang}
            onChange={(v) => set('translateLang', v)}
            options={[['auto', t('settings.translateAuto')], ...langs]}
          />
        </Row>
      </Section>
      <Section title={t('prefs.privacy')}>
        <small className="muted">{t('prefs.privacyNote')}</small>
        <div>
          <button
            onClick={() => {
              setConsent('translate', false)
              setConsent('dict', false)
              setConsentReset(true)
            }}
          >
            {t('settings.consentReset')}
          </button>
          {consentReset && <span role="status"> {t('settings.consentDone')}</span>}
        </div>
      </Section>
    </>
  )
}
