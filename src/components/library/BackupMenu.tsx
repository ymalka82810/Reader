import { useRef, useState } from 'react'
import { useBackGesture } from '../../hooks/useBackGesture'
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
  /** tapped backup/restore while something else is running: say so instead of doing nothing */
  onBusy: () => void
  onBackup: () => void
  onRestore: () => void
  onGoals: () => void
  onReview: () => void
  onFinished: () => void
  /** shown only while a filter is active: resets it */
  onClearFilter?: () => void
}

/** the "⋯" menu in the library header: actions only (goals, review, folders, selecting, backup, restore); settings are in the settings screen */
export function BackupMenu({ view, busy, onBusy, onBackup, onRestore, onGoals, onReview, onFinished, onClearFilter }: Props) {
  const [open, setOpen] = useState(false)
  // the phone's back swipe closes the open menu first
  useBackGesture(() => setOpen(false), 3, open)
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
      <button ref={trigger} className="quiet" aria-label={t('menu.more')} aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        ⋯
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => close()} />
          <div className="menu-pop" tabIndex={-1} autoFocus onKeyDown={(e) => menuKeyDown(e, () => close(true))}>
          <div className="menu" role="menu">
            <button role="menuitem" onClick={() => { close(); onGoals() }}>
              {t('goals.title')}
            </button>
            <button role="menuitem" onClick={() => { close(); onFinished() }}>
              {t('finished.title')}
            </button>
            <button role="menuitem" onClick={() => { close(); onReview() }}>
              {t('review.title')}
            </button>
            {onClearFilter && (
              <button role="menuitem" onClick={() => { close(); onClearFilter() }}>
                {t('filter.clear')}
              </button>
            )}
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
                aria-disabled={busy}
                className={busy ? 'dim' : undefined}
                onClick={() => {
                  close()
                  if (busy) onBusy()
                  else fn()
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
