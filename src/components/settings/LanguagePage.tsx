import { useState } from 'react'
import { changeLocale, getLocale, LOCALES, t } from '../../i18n'
import { hasConsent, setConsent, SERVICE_HOST, type Service } from '../../lib/consent'
import { DICT_LANGS, type Settings } from '../../lib/settings'
import { isNativeApp } from '../../lib/updater'
import type { SetSetting } from '../../hooks/useAppSettings'
import { Select } from '../Select'
import { Seg } from '../reader/shared'
import { Row, Section } from './parts'

/** the services that receive what the user selects; the online catalogs exist only in the Android app */
const SERVICES: Service[] = isNativeApp ? ['translate', 'dict', 'opds'] : ['translate', 'dict']

const SERVICE_NAME: Record<Service, string> = {
  translate: t('prefs.svc.translate'),
  dict: t('prefs.svc.dict'),
  opds: t('prefs.svc.opds'),
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
              hint={`${on ? t('prefs.consentOn') : t('prefs.consentOff')} · ${s === 'opds' ? t('prefs.svc.opdsHost') : SERVICE_HOST[s]}`}
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
    </>
  )
}
