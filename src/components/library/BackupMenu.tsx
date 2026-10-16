import { useState } from 'react'
import { formatBytes, type StorageStatus } from '../../lib/storage'
import type { AutoBackupState } from '../../lib/autoBackup'
import { isNativeApp } from '../../lib/updater'

export type Filter = 'all' | 'reading' | 'unread' | 'finished'
export type Sort = 'recent' | 'title' | 'author' | 'added'

const FILTERS: [Filter, string][] = [
  ['all', 'הכול'],
  ['reading', 'בקריאה'],
  ['unread', 'לא התחלתי'],
  ['finished', 'נקראו'],
]
const SORTS: [Sort, string][] = [
  ['recent', 'נפתח לאחרונה'],
  ['added', 'נוסף לאחרונה'],
  ['title', 'שם (א–ת)'],
  ['author', 'מחבר (א–ת)'],
]

type View = {
  filterSort: boolean
  filter: Filter
  onFilter: (f: Filter) => void
  sort: Sort
  onSort: (s: Sort) => void
  onNewFolder?: () => void
  selecting: boolean
  onToggleSelect: () => void
}

type Props = {
  view?: View
  busy: boolean
  storage?: StorageStatus
  onBackup: () => void
  onRestore: () => void
  onCheckUpdate: () => void
  auto: { state: AutoBackupState; last: number; onEnable: () => void; onDisable: () => void; onRenew: () => void }
}

/** the "⋯" menu in the library header: backup, restore, app update and storage status */
export function BackupMenu({ view, busy, storage, onBackup, onRestore, onCheckUpdate, auto }: Props) {
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
            {view && (
              <>
                {view.filterSort && (
                  <>
                    <div className="menu-title">סינון</div>
                    {FILTERS.map(([v, label]) => (
                      <button key={v} role="menuitemradio" aria-checked={view.filter === v} onClick={() => { view.onFilter(v); setOpen(false) }}>
                        {label}
                        {view.filter === v && <span aria-hidden="true"> ✓</span>}
                      </button>
                    ))}
                    <div className="menu-title">מיון</div>
                    {SORTS.map(([v, label]) => (
                      <button key={v} role="menuitemradio" aria-checked={view.sort === v} onClick={() => { view.onSort(v); setOpen(false) }}>
                        {label}
                        {view.sort === v && <span aria-hidden="true"> ✓</span>}
                      </button>
                    ))}
                    <div className="menu-sep" role="separator" />
                  </>
                )}
                {view.onNewFolder && (
                  <button role="menuitem" onClick={() => { setOpen(false); view.onNewFolder!() }}>
                    תיקייה חדשה
                  </button>
                )}
                <button role="menuitem" onClick={() => { setOpen(false); view.onToggleSelect() }}>
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
