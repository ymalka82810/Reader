import { useState } from 'react'
import { formatBytes, type StorageStatus } from '../../lib/storage'
import type { AutoBackupState } from '../../lib/autoBackup'
import { isNativeApp } from '../../lib/updater'

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
  auto: { state: AutoBackupState; last: number; onEnable: () => void; onDisable: () => void; onRenew: () => void }
}

/** the "⋯" menu in the library header: backup, restore, app update and storage status */
export function BackupMenu({ view, busy, storage, onPersist, onBackup, onRestore, onCheckUpdate, auto }: Props) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const items: [string, () => void, string][] = [
    ['גיבוי', onBackup, 'ספרים, מיקום קריאה, הערות והגדרות (אפשר להצפין בסיסמה)'],
    ['שחזור', onRestore, 'מוסיף ספרים חסרים וממזג מיקום והערות'],
  ]
  const autoTip = 'שומר גיבוי אחת ליום בתיקייה שתבחר (למשל תיקיית דרייב). הקובץ אינו מוצפן'
  if (auto.state === 'off') items.push(['גיבוי אוטומטי לתיקייה…', auto.onEnable, autoTip])
  else if (auto.state === 'needs-permission') items.push(['אשר גישה לגיבוי אוטומטי', auto.onRenew, 'הדפדפן ביקש לאשר מחדש גישה לתיקייה'])
  else if (auto.state === 'ready') items.push(['כבה גיבוי אוטומטי', auto.onDisable, autoTip])
  if (storage && !storage.persisted) items.push(['בקש אחסון קבוע', onPersist, 'מבקש מהדפדפן לא למחוק את הספרייה כשחסר מקום. אם הוא מסרב, גיבוי הוא ההגנה הבטוחה'])
  if (isNativeApp) items.push(['בדוק עדכון', onCheckUpdate, 'מחפש גרסה חדשה של האפליקציה ב-GitHub'])

  return (
    <div className="menu-wrap">
      <button aria-label="עוד פעולות" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        ⋯
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => close()} />
          <div className="menu-pop" tabIndex={-1} autoFocus onKeyDown={(e) => e.key === 'Escape' && close()}>
          <div className="menu" role="menu">
            {view && (
              <>
                {view.onNewFolder && (
                  <button role="menuitem" onClick={() => { close(); view.onNewFolder!() }}>
                    תיקייה חדשה
                  </button>
                )}
                <button role="menuitem" onClick={() => { close(); view.onToggleSelect() }}>
                  {view.selecting ? 'סיום בחירה' : 'בחירה'}
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
            {auto.state === 'ready' && (
              <div className="menu-info" role="status">
                גיבוי אוטומטי פעיל
                {auto.last ? ` · אחרון: ${new Date(auto.last).toLocaleString('he-IL')}` : ''}
              </div>
            )}
            {storage && (
              <div className="menu-info" role="status">
                {storage.persisted ? 'אחסון קבוע ✓' : 'אחסון לא קבוע'}
                {storage.usage != null && storage.quota
                  ? ` · בשימוש ${formatBytes(storage.usage)} מתוך ${formatBytes(storage.quota)}`
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
