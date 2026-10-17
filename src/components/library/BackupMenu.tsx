import { useState } from 'react'
import { formatBytes, type StorageStatus } from '../../lib/storage'
import type { AutoBackupState } from '../../lib/autoBackup'
import { isNativeApp } from '../../lib/updater'
import { changeLocale, getLocale, LOCALES, localeTag, t } from '../../i18n'

type View = {
  onNewFolder?: () => void
  selecting: boolean
  onToggleSelect: () => void
}

type Props = {
  view?: View
  busy: boolean
  storage?: StorageStatus
  onPersist: () => void
  onBackup: () => void
  onRestore: () => void
  onCheckUpdate: () => void
  onGoals: () => void
  onReview: () => void
  auto: { state: AutoBackupState; last: number; onEnable: () => void; onDisable: () => void; onRenew: () => void }
}

/** the "⋯" menu in the library header: backup, restore, app update and storage status */
export function BackupMenu({ view, busy, storage, onPersist, onBackup, onRestore, onCheckUpdate, onGoals, onReview, auto }: Props) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const items: [string, () => void, string][] = [
    [t('backup.title'), onBackup, t('menu.backupTip')],
    [t('menu.restore'), onRestore, t('menu.restoreTip')],
  ]
  const autoTip = t('menu.autoTip')
  if (auto.state === 'off') items.push([t('menu.autoOn'), auto.onEnable, autoTip])
  else if (auto.state === 'needs-permission') items.push([t('menu.autoRenew'), auto.onRenew, t('menu.autoRenewTip')])
  else if (auto.state === 'ready') items.push([t('menu.autoOff'), auto.onDisable, autoTip])
  if (storage && !storage.persisted) items.push([t('menu.persist'), onPersist, t('menu.persistTip')])
  if (isNativeApp) items.push([t('menu.checkUpdate'), onCheckUpdate, t('menu.checkUpdateTip')])

  return (
    <div className="menu-wrap">
      <button aria-label={t('menu.more')} aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        ⋯
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => close()} />
          <div className="menu-pop" tabIndex={-1} autoFocus onKeyDown={(e) => e.key === 'Escape' && close()}>
          <div className="menu" role="menu">
            <button role="menuitem" onClick={() => { close(); onGoals() }}>
              {t('goals.title')}
            </button>
            <button role="menuitem" onClick={() => { close(); onReview() }}>
              {t('review.title')}
            </button>
            {view && (
              <>
                {view.onNewFolder && (
                  <button role="menuitem" onClick={() => { close(); view.onNewFolder!() }}>
                    {t('folder.new')}
                  </button>
                )}
                <button role="menuitem" onClick={() => { close(); view.onToggleSelect() }}>
                  {view.selecting ? t('menu.endSelect') : t('menu.select')}
                </button>
                <div className="menu-sep" role="separator" />
              </>
            )}
            {items.map(([label, fn, tip]) => (
              <button
                key={label}
                role="menuitem"
                title={tip}
                disabled={busy}
                onClick={() => {
                  close()
                  fn()
                }}
              >
                {label}
              </button>
            ))}
            {LOCALES.filter(([code]) => code !== getLocale()).map(([code, name]) => (
              <button key={code} role="menuitem" title={t('menu.language')} onClick={() => changeLocale(code)}>
                🌐 {name}
              </button>
            ))}
            {auto.state === 'ready' && (
              <div className="menu-info" role="status">
                {t('menu.autoActive')}
                {auto.last ? ` · ${t('menu.autoLast', { date: new Date(auto.last).toLocaleString(localeTag()) })}` : ''}
              </div>
            )}
            {storage && (
              <div className="menu-info" role="status">
                {storage.persisted ? t('menu.storagePersisted') : t('menu.storageNotPersisted')}
                {storage.usage != null && storage.quota
                  ? ` · ${t('menu.storageUsage', { used: formatBytes(storage.usage), total: formatBytes(storage.quota) })}`
                  : ''}
              </div>
            )}
          </div>
          </div>
        </>
      )}
    </div>
  )
}
