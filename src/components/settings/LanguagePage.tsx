import { useState } from 'react'
import { changeLocale, getLocale, LOCALES, t } from '../../i18n'
import { hasConsent, setConsent, SERVICE_HOST, type Service } from '../../lib/consent'
import { DICT_LANGS, type Settings } from '../../lib/settings'
import type { SetSetting } from '../../hooks/useAppSettings'
import { Select } from '../Select'
import { Seg } from '../reader/shared'
import { Row, Section, Toggle } from './parts'

/** the services that receive what the user selects */
const SERVICES: Service[] = ['translate', 'dict', 'books']

const SERVICE_NAME: Record<Service, string> = {
  translate: t('prefs.svc.translate'),
  dict: t('prefs.svc.dict'),
  books: t('prefs.svc.books'),
}

export function LanguagePage({ settings, set }: { settings: Settings; set: SetSetting }) {
  // the permissions live in localStorage, outside React state: this only makes a withdrawal re-render
  const [, rerender] = useState(0)
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
        {SERVICES.map((s) => {
          const on = hasConsent(s)
          return (
            <Row
              key={s}
              label={SERVICE_NAME[s]}
              hint={`${on ? t('prefs.consentOn') : t('prefs.consentOff')} · ${SERVICE_HOST[s]}`}
            >
              {on && (
                <button
                  aria-label={`${t('prefs.consentRevoke')}: ${SERVICE_NAME[s]}`}
                  onClick={() => {
                    setConsent(s, false)
                    rerender((n) => n + 1)
                  }}
                >
                  {t('prefs.consentRevoke')}
                </button>
              )}
            </Row>
          )
        })}
      </Section>
      <Section title={t('prefs.identifySection')}>
        <Toggle
          label={t('prefs.autoIdentify')}
          hint={t('prefs.autoIdentifyHint')}
          checked={settings.autoIdentify}
          onChange={(v) => set('autoIdentify', v)}
        />
        {settings.autoIdentify && (
          <Toggle
            label={t('prefs.autoIdentifySave')}
            hint={t('prefs.autoIdentifySaveHint')}
            checked={settings.autoIdentifySave}
            onChange={(v) => set('autoIdentifySave', v)}
          />
        )}
      </Section>
    </>
  )
}
