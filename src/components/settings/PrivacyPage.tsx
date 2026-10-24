import { useState } from 'react'
import { t } from '../../i18n'
import { hasConsent, setConsent, SERVICE_HOST, type Service } from '../../lib/consent'
import { isNativeApp } from '../../lib/updater'
import { Row, Section } from './parts'

/** the services that receive what the user selects, each behind its own permission */
const SERVICES: Service[] = ['translate', 'dict', 'books']

const SERVICE_NAME: Record<Service, string> = {
  translate: t('prefs.svc.translate'),
  dict: t('prefs.svc.dict'),
  books: t('prefs.svc.books'),
}

const SERVICE_SENT: Record<Service, string> = {
  translate: t('prefs.sent.translate'),
  dict: t('prefs.sent.dict'),
  books: t('prefs.sent.books'),
}

/** one place that says what leaves the device, where it goes and whether the user allowed it */
export function PrivacyPage() {
  // the permissions live in localStorage, outside React state: this only makes a withdrawal re-render
  const [, rerender] = useState(0)
  return (
    <>
      <Section title={t('prefs.privacySent')}>
        <small className="muted">{t('prefs.privacyNote')}</small>
        {SERVICES.map((s) => {
          const on = hasConsent(s)
          return (
            <Row
              key={s}
              label={SERVICE_NAME[s]}
              hint={`${on ? t('prefs.consentOn') : t('prefs.consentOff')} · ${t('prefs.sentWhat')}: ${SERVICE_SENT[s]} · ${t('prefs.sentTo')}: ${SERVICE_HOST[s]}`}
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
        {isNativeApp && (
          <Row
            label={t('prefs.svc.update')}
            hint={`${t('prefs.updateNoConsent')} · ${t('prefs.sentWhat')}: ${t('prefs.sent.update')} · ${t('prefs.sentTo')}: api.github.com`}
          />
        )}
      </Section>
      <Section title={t('prefs.privacyLocal')}>
        <p className="prefs-about">{t('prefs.privacyLocalText')}</p>
      </Section>
    </>
  )
}
