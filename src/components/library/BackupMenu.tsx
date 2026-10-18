import { useRef, useState } from 'react'
import { t } from '../../i18n'
import { menuKeyDown } from '../menuKeys'

type View = {
  onNewFolder?: () => void
  selecting: boolean
  onToggleSelect: () => void
}

type Props = {
  view?: View
  busy: boolean
  onBackup: () => void
  onRestore: () => void
  onGoals: () => void
  onReview: () => void
  onCatalog: () => void
}

/** the "⋯" menu in the library header: actions only (catalogs, goals, review, folders, selecting, backup, restore); settings are in the settings screen */
export function BackupMenu({ view, busy, onBackup, onRestore, onGoals, onReview, onCatalog }: Props) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = (refocus = false) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  const items: [string, () => void, string][] = [
    [t('backup.title'), onBackup, t('menu.backupTip')],
    [t('menu.restore'), onRestore, t('menu.restoreTip')],
  ]

  return (
    <div className="menu-wrap">
      <button ref={trigger} aria-label={t('menu.more')} aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        ⋯
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => close()} />
          <div className="menu-pop" tabIndex={-1} autoFocus onKeyDown={(e) => menuKeyDown(e, () => close(true))}>
          <div className="menu" role="menu">
            <button role="menuitem" title={t('opds.menuTip')} disabled={busy} onClick={() => { close(); onCatalog() }}>
              {t('opds.menu')}
            </button>
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
          </div>
          </div>
        </>
      )}
    </div>
  )
}
