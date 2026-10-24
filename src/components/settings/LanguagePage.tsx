import { useState } from 'react'
import { changeLocale, getLocale, LOCALES, t } from '../../i18n'
import { DICT_LANGS, type Settings } from '../../lib/settings'
import { testGoogleBooksKey } from '../../lib/bookLookup'
import type { SetSetting } from '../../hooks/useAppSettings'
import { Select } from '../Select'
import { IdentifyStats } from './IdentifyStats'
import { LibraryHealth } from './LibraryHealth'
import { OfflineDictSection } from './OfflineDictSection'
import { Row, Section, Toggle } from './parts'

export function LanguagePage({ settings, set }: { settings: Settings; set: SetSetting }) {
  const langs = DICT_LANGS.map(([code, name]): [string, string] => [code, name])
  return (
    <>
      <Section title={t('prefs.ifaceLang')}>
        <Select label={t('prefs.ifaceLang')} value={getLocale()} onChange={changeLocale} options={LOCALES} />
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
      <OfflineDictSection />
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
        <GoogleKey value={settings.googleBooksKey} onChange={(v) => set('googleBooksKey', v)} />
        <IdentifyStats />
        <LibraryHealth />
      </Section>
    </>
  )
}

/** the user's own Google Books key, with a button that tries it */
function GoogleKey({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [result, setResult] = useState<string>()
  const [busy, setBusy] = useState(false)
  return (
    <Row stacked label={t('prefs.googleKey')} hint={t('prefs.googleKeyHint')}>
      <input
        type="text"
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        value={value}
        aria-label={t('prefs.googleKey')}
        onChange={(e) => {
          onChange(e.target.value.trim())
          setResult(undefined)
        }}
      />
      <button
        disabled={!value.trim() || busy}
        onClick={() => {
          setBusy(true)
          void testGoogleBooksKey(value).then((why) => {
            setBusy(false)
            setResult(why ? t('prefs.googleKeyBad', { why }) : t('prefs.googleKeyOk'))
          })
        }}
      >
        {t('prefs.googleKeyTest')}
      </button>
      {result && (
        <small role="status" className="muted">
          {result}
        </small>
      )}
    </Row>
  )
}
