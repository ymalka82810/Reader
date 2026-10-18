import { isNativeApp } from '../../lib/updater'
import type { EyeStatus } from '../../hooks/useEyeScroll'
import type { Flow } from '../../lib/settings'
import { EYE_SCROLL_AVAILABLE, type OrientationLock, type Spread, type ViewModes } from '../../lib/viewModes'
import { Seg } from './shared'
import { t } from '../../i18n'
import './viewModes.css'

const EYE_STATUS: Record<EyeStatus, string> = {
  off: '',
  starting: t('eye.starting'),
  calibrating: t('eye.calibrating'),
  active: t('eye.active'),
  denied: t('eye.denied'),
  error: t('eye.error'),
}

export function ViewModesSection({
  modes,
  setMode,
  flow,
  eyeStatus,
  onRecalibrate,
}: {
  modes: ViewModes
  setMode: <K extends keyof ViewModes>(k: K, v: ViewModes[K]) => void
  flow: Flow
  eyeStatus: EyeStatus
  onRecalibrate: () => void
}) {
  return (
    <fieldset className="view-modes">
      <legend>{t('modes.title')}</legend>
      <div className="mode-row">
        <span>{t('modes.spread')}</span>
        <Seg<Spread>
          value={modes.spread}
          onChange={(v) => setMode('spread', v)}
          options={[['auto', t('modes.auto')], ['single', t('modes.single')], ['double', t('modes.double')]]}
        />
        {flow === 'scrolled' && <small className="muted">{t('modes.spreadNote')}</small>}
      </div>
      <div className="mode-row">
        <span>{t('modes.orientation')}</span>
        <Seg<OrientationLock>
          value={modes.orientation}
          onChange={(v) => setMode('orientation', v)}
          options={[['free', t('modes.free')], ['portrait', t('modes.portrait')], ['landscape', t('modes.landscape')]]}
        />
      </div>
      {!isNativeApp && (
        <label className="check">
          <input type="checkbox" checked={modes.focus} onChange={(e) => setMode('focus', e.target.checked)} />
          {t('modes.focus')} <kbd>f</kbd>
        </label>
      )}
      {EYE_SCROLL_AVAILABLE && (
        <label className="check">
          <input type="checkbox" checked={modes.eyeScroll} onChange={(e) => setMode('eyeScroll', e.target.checked)} />
          {t('modes.eye')}
        </label>
      )}
      {EYE_SCROLL_AVAILABLE && modes.eyeScroll && (
        <div className="eye-status" role="status">
          {EYE_STATUS[eyeStatus]}
          {eyeStatus === 'active' && (
            <button onClick={onRecalibrate}>{t('modes.recalibrate')}</button>
          )}
        </div>
      )}
    </fieldset>
  )
}
