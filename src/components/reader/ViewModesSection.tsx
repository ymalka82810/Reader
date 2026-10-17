import type { EyeStatus } from '../../hooks/useEyeScroll'
import type { Flow } from '../../lib/settings'
import type { OrientationLock, Spread, ViewModes } from '../../lib/viewModes'
import { Seg } from './shared'
import './viewModes.css'

const EYE_STATUS: Record<EyeStatus, string> = {
  off: '',
  starting: 'מפעיל מצלמה…',
  calibrating: 'מכייל: הסתכל באמצע הטקסט כשתי שניות',
  active: 'פעיל: מבט ממושך לתחתית המסך — קדימה, לראשו — אחורה',
  denied: 'אין הרשאה למצלמה',
  error: 'לא ניתן להפעיל את זיהוי המבט במכשיר זה',
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
      <legend>מצבי תצוגה</legend>
      <div className="mode-row">
        <span>עמודים בטאבלט</span>
        <Seg<Spread>
          value={modes.spread}
          onChange={(v) => setMode('spread', v)}
          options={[['auto', 'אוטומטי'], ['single', 'עמוד אחד'], ['double', 'שני עמודים']]}
        />
        {flow === 'scrolled' && <small className="muted">חל במצב עמודים; במצב גלילה אין חלוקה לעמודים</small>}
      </div>
      <div className="mode-row">
        <span>נעילת כיוון מסך</span>
        <Seg<OrientationLock>
          value={modes.orientation}
          onChange={(v) => setMode('orientation', v)}
          options={[['free', 'חופשי'], ['portrait', 'לאורך'], ['landscape', 'לרוחב']]}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={modes.focus} onChange={(e) => setMode('focus', e.target.checked)} />
        מצב ללא הסחות (מסך מלא, תפריטים רק בהקשה באמצע) — קיצור: <kbd>f</kbd>
      </label>
      <label className="check">
        <input type="checkbox" checked={modes.eyeScroll} onChange={(e) => setMode('eyeScroll', e.target.checked)} />
        גלילה במבט (מצלמה קדמית, ניסיוני) — העיבוד במכשיר בלבד, דבר אינו נשמר או נשלח
      </label>
      {modes.eyeScroll && (
        <div className="eye-status" role="status">
          {EYE_STATUS[eyeStatus]}
          {eyeStatus === 'active' && (
            <button onClick={onRecalibrate}>כיול מחדש</button>
          )}
        </div>
      )}
    </fieldset>
  )
}
