import { useState } from 'react'
import { formatBytes, type StorageStatus } from '../../lib/storage'
import type { AutoBackupState } from '../../lib/autoBackup'
import { isNativeApp } from '../../lib/updater'

type Props = {
  busy: boolean
  storage?: StorageStatus
  onBackup: () => void
  onRestore: () => void
  onCheckUpdate: () => void
  auto: { state: AutoBackupState; last: number; onEnable: () => void; onDisable: () => void; onRenew: () => void }
}

/** the "⋯" menu in the library header: backup, restore, app update and storage status */
export function BackupMenu({ busy, storage, onBackup, onRestore, onCheckUpdate, auto }: Props) {
  const [open, setOpen] = useState(false)
  const items: [string, () => void, string][] = [
    ['גיבוי', onBackup, 'ספרים, מיקום קריאה, הערות והגדרות (אפשר להצפין בסיסמה)'],
    ['שחזור', onRestore, 'מוסיף ספרים חסרים וממזג מיקום והערות'],
  ]
  const autoTip = 'שומר גיבוי אחת ליום בתיקייה שתבחר (למשל תיקיית דרייב). הקובץ אינו מוצפן'
  if (auto.state === 'off') items.push(['גיבוי אוטומטי לתיקייה…', auto.onEnable, autoTip])
  else if (auto.state === 'needs-permission') items.push(['אשר גישה לגיבוי אוטומטי', auto.onRenew, 'הדפדפן ביקש לאשר מחדש גישה לתיקייה'])
  else if (auto.state === 'ready') items.push(['כבה גיבוי אוטומטי', auto.onDisable, autoTip])
  if (isNativeApp) items.push(['בדוק עדכון', onCheckUpdate, 'מחפש גרסה חדשה של האפליקציה ב-GitHub'])

  return (
    <div className="menu-wrap">
      <button aria-label="עוד פעולות" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((m) => !m)}>
        ⋯
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
            {items.map(([label, fn, tip]) => (
              <button
                key={label}
                role="menuitem"
                title={tip}
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  fn()
                }}
              >
                {label}
              </button>
            ))}
            {auto.state === 'ready' && (
              <div className="menu-info" role="status">
                גיבוי אוטומטי פעיל
                {auto.last ? ` · אחרון: ${new Date(auto.last).toLocaleString('he-IL')}` : ''}
              </div>
            )}
            {storage && (
              <div className="menu-info" role="status">
                {storage.persisted ? 'אחסון קבוע ✓' : 'אחסון לא קבוע — הדפדפן עלול למחוק את הספרייה'}
                {storage.usage != null && storage.quota
                  ? ` · בשימוש ${formatBytes(storage.usage)} מתוך ${formatBytes(storage.quota)}`
                  : ''}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
