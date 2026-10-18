import { formatBytes, type StorageStatus } from '../../lib/storage'
import type { BackupRemind, Settings } from '../../lib/settings'
import type { SetSetting } from '../../hooks/useAppSettings'
import { Select } from '../Select'
import type { AutoBackupState } from '../../lib/autoBackup'
import { isNativeApp } from '../../lib/updater'
import { localeTag, t } from '../../i18n'
import { Row, Section } from './parts'

/** what the library screen lends to the settings: its backup actions and the state they report */
export type BackupActions = {
  busy: boolean
  storage?: StorageStatus
  onPersist: () => void
  onBackup: () => void
  onRestore: () => void
  auto: { state: AutoBackupState; last: number; onEnable: () => void; onDisable: () => void; onRenew: () => void }
}

const REMINDERS: [BackupRemind, string][] = [
  ['default', t('prefs.reminder.default')],
  ['week', t('prefs.reminder.week')],
  ['month', t('prefs.reminder.month')],
  ['off', t('prefs.reminder.off')],
]

const AUTO_STATE: Record<AutoBackupState, string> = {
  unsupported: '',
  off: t('prefs.autoStateOff'),
  ready: t('prefs.autoStateReady'),
  'needs-permission': t('prefs.autoStateRenew'),
}

/** backup, restore, the daily automatic backup and storage status; `leave` closes the settings, so a long
 *  backup shows its progress in the library instead of behind this screen */
export function BackupPage({ actions, leave, settings, set }: { actions: BackupActions; leave: () => void; settings: Settings; set: SetSetting }) {
  const { busy, storage, auto } = actions
  const run = (fn: () => void) => () => {
    leave()
    fn()
  }
  return (
    <>
      <Section title={t('prefs.backupSection')}>
        <Row label={t('backup.title')} hint={t('menu.backupTip')}>
          <button disabled={busy} onClick={run(actions.onBackup)}>{t('backup.title')}</button>
        </Row>
        <Row label={t('menu.restore')} hint={t('menu.restoreTip')}>
          <button disabled={busy} onClick={run(actions.onRestore)}>{t('menu.restore')}</button>
        </Row>
      </Section>
      <Section title={t('prefs.autoSection')}>
        {auto.state === 'unsupported' ? (
          <small className="muted">{t('prefs.autoUnsupported')}</small>
        ) : (
          <>
            <Row label={AUTO_STATE[auto.state]} hint={t('menu.autoTip')}>
              {auto.state === 'off' && <button disabled={busy} onClick={auto.onEnable}>{t('menu.autoOn')}</button>}
              {auto.state === 'needs-permission' && <button disabled={busy} onClick={auto.onRenew}>{t('menu.autoRenew')}</button>}
              {auto.state === 'ready' && <button disabled={busy} onClick={auto.onDisable}>{t('menu.autoOff')}</button>}
            </Row>
            <small className="muted" role="status">
              {t('menu.autoLast', { date: auto.last ? new Date(auto.last).toLocaleString(localeTag()) : t('prefs.never') })}
            </small>
          </>
        )}
      </Section>
      <Section title={t('prefs.reminderSection')}>
        <Row label={t('prefs.reminder')} hint={t('prefs.reminderNote')}>
          <Select<BackupRemind>
            label={t('prefs.reminder')}
            value={settings.backupRemind}
            onChange={(v) => set('backupRemind', v)}
            options={REMINDERS}
          />
        </Row>
      </Section>
      <Section title={t('prefs.storageSection')}>
        {isNativeApp ? (
          <small className="muted">{t('prefs.storageNative')}</small>
        ) : !storage ? (
          <small className="muted">{t('prefs.storageUnknown')}</small>
        ) : (
          <Row
            label={storage.persisted ? t('menu.storagePersisted') : t('menu.storageNotPersisted')}
            hint={
              (storage.usage != null && storage.quota
                ? t('menu.storageUsage', { used: formatBytes(storage.usage), total: formatBytes(storage.quota) }) + '. '
                : '') + (storage.persisted ? '' : t('menu.persistTip'))
            }
          >
            {!storage.persisted && <button onClick={actions.onPersist}>{t('menu.persist')}</button>}
          </Row>
        )}
      </Section>
    </>
  )
}
