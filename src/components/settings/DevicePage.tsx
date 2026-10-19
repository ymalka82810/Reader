import { useEffect, useState } from 'react'
import type { Settings } from '../../lib/settings'
import type { SetSetting } from '../../hooks/useAppSettings'
import {
  hasDeviceAccess,
  normalizeFolder,
  pickDeviceFolder,
  requestDeviceAccess,
  requestNotificationAccess,
  syncBackgroundScan,
} from '../../lib/deviceBooks'
import { t } from '../../i18n'
import { Row, Section, Toggle } from './parts'

/** Android app: the books already on the phone — access, automatic scan, the folders looked through */
export function DevicePage({ settings, set, busy, onScan }: { settings: Settings; set: SetSetting; busy: boolean; onScan: (retry?: boolean) => void }) {
  const [access, setAccess] = useState<boolean>()
  const [error, setError] = useState('')
  const [bgNote, setBgNote] = useState('')
  useEffect(() => {
    // re-checked on return, since access is given (or taken away) in Android's own settings
    const check = () => document.visibilityState === 'visible' && void hasDeviceAccess().then(setAccess)
    check()
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [])

  const allow = async () => {
    setError('')
    try {
      setAccess(await requestDeviceAccess())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const toggleBackground = async (on: boolean) => {
    setBgNote('')
    set('deviceBackgroundScan', on)
    // the announcement is a notification, so the permission is asked for right when the user turns this on
    if (on && !(await requestNotificationAccess())) setBgNote(t('device.notifOff'))
    await syncBackgroundScan({ deviceBackgroundScan: on, deviceFolders: settings.deviceFolders })
  }

  const folders = settings.deviceFolders
  const addFolder = async () => {
    setError('')
    try {
      const picked = await pickDeviceFolder()
      if (picked === undefined) return
      const f = normalizeFolder(picked)
      if (!folders.includes(f)) set('deviceFolders', [...folders, f])
    } catch (e) {
      setError(e instanceof Error && e.message === 'not local' ? t('device.notLocal') : String(e instanceof Error ? e.message : e))
    }
  }
  const name = (f: string) => f || t('device.allStorage')

  return (
    <>
      <Section title={t('device.section')}>
        <small className="muted">{t('device.intro')}</small>
        <Row label={access ? t('device.accessGranted') : t('device.accessMissing')} hint={t('device.accessHint')}>
          {access === false && <button onClick={allow}>{t('device.accessOk')}</button>}
        </Row>
        <Toggle
          label={t('device.auto')}
          hint={t('device.autoHint')}
          checked={settings.deviceAutoScan}
          onChange={(v) => set('deviceAutoScan', v)}
        />
        <Toggle
          label={t('device.bg')}
          hint={t('device.bgHint')}
          checked={settings.deviceBackgroundScan}
          onChange={(v) => void toggleBackground(v)}
        />
        <Toggle
          label={t('device.renameSync')}
          hint={t('device.renameSyncHint')}
          checked={settings.phoneRenameSync}
          onChange={(v) => set('phoneRenameSync', v)}
        />
        <Row label={t('device.scanNow')} hint={t('device.scanNowHint')}>
          <button disabled={busy || !folders.length} onClick={() => onScan()}>{t('device.scanNow')}</button>
        </Row>
        <Row label={t('device.retry')} hint={t('device.retryHint')}>
          <button disabled={busy || !folders.length} onClick={() => onScan(true)}>{t('device.retryButton')}</button>
        </Row>
        {bgNote && <div role="alert" className="muted">{bgNote}</div>}
      </Section>
      <Section title={t('device.folders')}>
        {folders.length ? (
          folders.map((f) => (
            <Row key={f} label={name(f)}>
              <button aria-label={t('device.removeFolder', { name: name(f) })} onClick={() => set('deviceFolders', folders.filter((x) => x !== f))}>
                ✕
              </button>
            </Row>
          ))
        ) : (
          <small className="muted">{t('device.noFolders')}</small>
        )}
        <Row label={t('device.addFolder')}>
          <button onClick={addFolder}>{t('device.addFolder')}</button>
        </Row>
        {error && <div role="alert" className="muted">{error}</div>}
      </Section>
    </>
  )
}
