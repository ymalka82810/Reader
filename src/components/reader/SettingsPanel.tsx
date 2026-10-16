import { MAX_FONT, MIN_FONT } from '../../hooks/useBookEvents'
import { DICT_LANGS, type Flow, type Settings, type Theme } from '../../lib/settings'
import { Panel, Seg } from './shared'

export function SettingsPanel({
  settings,
  set,
  bump,
}: {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  bump: (delta: number) => void
}) {
  return (
    <Panel label="הגדרות תצוגה" className="settings">
      <div className="row">
        <button onClick={() => bump(-2)} aria-label="הקטן">א−</button>
        <input
          type="range"
          min={MIN_FONT}
          max={MAX_FONT}
          value={settings.fontSize}
          aria-label="גודל גופן"
          onChange={(e) => set('fontSize', parseInt(e.target.value))}
        />
        <button onClick={() => bump(2)} aria-label="הגדל">א+</button>
      </div>
      <div className="row">
        <label htmlFor="lh">ריווח שורות</label>
        <input
          id="lh"
          type="range"
          min={1.2}
          max={2.4}
          step={0.1}
          value={settings.lineHeight}
          onChange={(e) => set('lineHeight', parseFloat(e.target.value))}
        />
      </div>
      <Seg<Flow>
        value={settings.flow}
        onChange={(v) => set('flow', v)}
        options={[['scrolled', 'גלילה'], ['paginated', 'עמודים']]}
      />
      <Seg<Theme>
        value={settings.theme}
        onChange={(v) => set('theme', v)}
        options={[['light', 'בהיר'], ['sepia', 'ספיה'], ['dark', 'כהה']]}
      />
      <Seg<Settings['fontFamily']>
        value={settings.fontFamily}
        onChange={(v) => set('fontFamily', v)}
        options={[['default', 'ברירת מחדל'], ['serif', 'סריף'], ['sans', 'סנס']]}
      />
      <label className="check">
        <input type="checkbox" checked={settings.justify} onChange={(e) => set('justify', e.target.checked)} />
        יישור לשני הצדדים
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.accessible} onChange={(e) => set('accessible', e.target.checked)} />
        מצב נגיש (דיסלקסיה / ראייה חלשה): ריווח מוגדל וגופן פשוט
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.pageTransition} onChange={(e) => set('pageTransition', e.target.checked)} />
        אנימציית מעבר בין עמודים
      </label>
      <label className="check">
        מילון (ויקימילון):{' '}
        <select value={settings.dictLang} onChange={(e) => set('dictLang', e.target.value)}>
          <option value="auto">לפי שפת הספר</option>
          {DICT_LANGS.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <ul className="shortcuts">
        <li><kbd>←</kbd> <kbd>→</kbd> <kbd>רווח</kbd> מעבר עמוד</li>
        <li><kbd>+</kbd> <kbd>-</kbd> גודל גופן</li>
        <li><kbd>b</kbd> סימנייה · <kbd>t</kbd> תוכן · <kbd>n</kbd> הערות</li>
        <li><kbd>a</kbd> או הקשה באמצע המסך: קריאה אוטומטית · <kbd>,</kbd> <kbd>.</kbd> לאט/מהר יותר</li>
        <li><kbd>r</kbd> הקראה בקול</li>
        <li><kbd>/</kbd> חיפוש · <kbd>s</kbd> הגדרות · <kbd>Esc</kbd> סגירה</li>
      </ul>
    </Panel>
  )
}
