import { useState, type ReactNode } from 'react'
import { hasConsent, setConsent, SERVICE_HOST, type Service } from '../../lib/consent'
import { Panel } from './shared'
import { t } from '../../i18n'

/** shows `children` (the panel that calls the service) only once the user agreed to send text to it */
export function ConsentGate({ service, onClose, children }: { service: Service; onClose: () => void; children: ReactNode }) {
  const [ok, setOk] = useState(() => hasConsent(service))
  if (ok) return <>{children}</>
  return (
    <Panel label={t('consent.title')} className="dict">
      <h3>{t('consent.title')}</h3>
      <p>{t(service === 'translate' ? 'consent.translate' : 'consent.dict', { host: SERVICE_HOST[service] })}</p>
      <p className="muted">{t('consent.revoke')}</p>
      <div className="row">
        <button onClick={onClose}>{t('common.cancel')}</button>
        <span style={{ flex: 1 }} />
        <button
          className="primary"
          onClick={() => {
            setConsent(service, true)
            setOk(true)
          }}
        >
          {t('consent.allow')}
        </button>
      </div>
    </Panel>
  )
}
