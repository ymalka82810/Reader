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
  onPersist: () => void
  onBackup: () => void
  onRestore: () => void
  onCheckUpdate: () => void
  auto: { state: AutoBackupState; last: number; onEnable: () => void; onDisable: () => void; onRenew: () => void }
}

/** a menu row that opens its choices in a separate panel beside the menu; the row shows the current one */
function SubMenuRow({ label, current, open, onToggle }: {
  label: string
  current?: string
  open: boolean
  onToggle: (top: number) => void
}) {
  return (
    <button className="menu-sub" role="menuitem" aria-haspopup="menu" aria-expanded={open} onClick={(e) => onToggle(e.currentTarget.offsetTop)}>
      <span>{label}</span>
      <span className="menu-sub-value">
        {current} <span aria-hidden="true">{open ? '◂' : '▸'}</span>
      </span>
    </button>
  )
}

function SubMenuPanel<T extends string>({ label, options, value, top, onPick }: {
  label: string
  options: [T, string][]
  value: T
  top: number
  onPick: (v: T) => void
}) {
  return (
    <div className="menu menu-side" role="menu" aria-label={label} style={{ marginTop: top }}>
      {options.map(([v, text]) => (
        <button key={v} role="menuitemradio" aria-checked={value === v} onClick={() => onPick(v)}>
          {text}
          {value === v && <span aria-hidden="true"> ✓</span>}
        </button>
      ))}
    </div>
  )
}

/** the "⋯" menu in the library header: backup, restore, app update and storage status */
export function BackupMenu({ view, busy, storage, onPersist, onBackup, onRestore, onCheckUpdate, auto }: Props) {
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState<{ which: 'filter' | 'sort'; top: number } | null>(null)
  const close = () => {
    setOpen(false)
    setSub(null)
  }
  const toggleSub = (which: 'filter' | 'sort', top: number) => setSub((cur) => (cur?.which === which ? null : { which, top }))
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
                {view.filterSort && (
                  <>
                    <SubMenuRow label="סינון" current={FILTERS.find(([v]) => v === view.filter)?.[1]} open={sub?.which === 'filter'} onToggle={(top) => toggleSub('filter', top)} />
                    <SubMenuRow label="מיון" current={SORTS.find(([v]) => v === view.sort)?.[1]} open={sub?.which === 'sort'} onToggle={(top) => toggleSub('sort', top)} />
                    <div className="menu-sep" role="separator" />
                  </>
                )}
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
          {view?.filterSort && sub?.which === 'filter' && (
            <SubMenuPanel label="סינון" options={FILTERS} value={view.filter} top={sub.top} onPick={(v) => { view.onFilter(v); close() }} />
          )}
          {view?.filterSort && sub?.which === 'sort' && (
            <SubMenuPanel label="מיון" options={SORTS} value={view.sort} top={sub.top} onPick={(v) => { view.onSort(v); close() }} />
          )}
          </div>
        </>
      )}
    </div>
  )
}
