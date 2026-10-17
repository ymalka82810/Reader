import { useState, type ReactNode } from 'react'
import { MAX_FONT, MIN_FONT } from '../../hooks/useBookEvents'
import { CUSTOM_FONT_FAMILY, removeCustomFont, saveCustomFont, type CustomFont } from '../../lib/customFont'
import { DICT_LANGS, FONTS, type Flow, type Settings, type Theme } from '../../lib/settings'
import { Select } from '../Select'
import { Panel, Seg } from './shared'

export function SettingsPanel({
  settings,
  set,
  bump,
  customFont,
  setCustomFont,
  children,
}: {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  bump: (delta: number) => void
  customFont: CustomFont | undefined
  setCustomFont: (f: CustomFont | undefined) => void
  /** extra sections, shown before the shortcuts list */
  children?: ReactNode
}) {
  const [fontError, setFontError] = useState('')
  const upload = async (file: File | undefined) => {
    if (!file) return
    try {
      setCustomFont(await saveCustomFont(file))
      set('fontFamily', 'custom')
      setFontError('')
    } catch (e) {
      setFontError(e instanceof Error ? e.message : 'העלאת הגופן נכשלה')
    }
  }
  const dropFont = async () => {
    await removeCustomFont()
    setCustomFont(undefined)
    if (settings.fontFamily === 'custom') set('fontFamily', 'default')
  }
  const fontRows: [string, string, string][] = [
    ...Object.entries(FONTS).map(([k, f]): [string, string, string] => [k, f.label, f.family]),
    ...(customFont ? [['custom', customFont.name, `"${CUSTOM_FONT_FAMILY}"`] as [string, string, string]] : []),
  ]
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
        options={[['light', 'בהיר'], ['sepia', 'ספיה'], ['dark', 'כהה'], ['custom', 'מותאם']]}
      />
      {settings.theme === 'custom' && (
        <div className="row colors">
          <label>רקע <input type="color" value={settings.customBg} onChange={(e) => set('customBg', e.target.value)} /></label>
          <label>טקסט <input type="color" value={settings.customFg} onChange={(e) => set('customFg', e.target.value)} /></label>
          <label>קישורים <input type="color" value={settings.customLink} onChange={(e) => set('customLink', e.target.value)} /></label>
        </div>
      )}
      <div className="row">
        <label htmlFor="bright">בהירות מסך</label>
        <input id="bright" type="range" min={0.3} max={1} step={0.05} value={settings.brightness} onChange={(e) => set('brightness', parseFloat(e.target.value))} />
      </div>
      <div className="row">
        <label htmlFor="ls">מרווח אותיות</label>
        <input id="ls" type="range" min={0} max={0.2} step={0.01} value={settings.letterSpacing} onChange={(e) => set('letterSpacing', parseFloat(e.target.value))} />
      </div>
      <div className="row">
        <label htmlFor="cw">רוחב טור</label>
        <input id="cw" type="range" min={320} max={1200} step={20} value={settings.columnWidth || 720} onChange={(e) => set('columnWidth', parseInt(e.target.value))} />
        <button onClick={() => set('columnWidth', 0)} aria-label="רוחב טור אוטומטי" disabled={!settings.columnWidth}>אוטו</button>
      </div>
      <div className="row">
        <label htmlFor="mg">שוליים</label>
        <input id="mg" type="range" min={0} max={20} step={1} value={settings.margin} onChange={(e) => set('margin', parseInt(e.target.value))} />
      </div>
      <table className="fonts" aria-label="גופנים">
        <tbody>
          {fontRows.map(([key, label, family]) => (
            <tr key={key}>
              <td>
                <button className={key === settings.fontFamily ? 'on' : ''} aria-pressed={key === settings.fontFamily} onClick={() => set('fontFamily', key)}>
                  <span>{label}</span>
                  <span className="sample" style={family ? { fontFamily: family } : undefined}>אבג Abc</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <label className="upload">
          העלאת גופן
          <input type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {customFont && <button onClick={() => void dropFont()}>הסרת הגופן</button>}
      </div>
      {fontError && <div role="alert" className="muted">{fontError}</div>}
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
      <div className="check">
        מילון (ויקימילון):{' '}
        <Select
          label="שפת מילון"
          value={settings.dictLang}
          onChange={(v) => set('dictLang', v)}
          options={[['auto', 'לפי שפת הספר'], ...DICT_LANGS.map(([code, name]): [string, string] => [code, name])]}
        />
      </div>
      {children}
      <details className="shortcuts">
        <summary>קיצורי מקלדת</summary>
        <ul>
          <li><kbd>←</kbd> <kbd>→</kbd> <kbd>רווח</kbd> מעבר עמוד</li>
          <li><kbd>+</kbd> <kbd>-</kbd> גודל גופן</li>
          <li><kbd>b</kbd> סימנייה · <kbd>[</kbd> <kbd>]</kbd> סימנייה קודמת/הבאה</li>
          <li><kbd>t</kbd> תוכן · <kbd>n</kbd> סימניות והדגשות</li>
          <li><kbd>a</kbd> או הקשה באמצע המסך: קריאה אוטומטית · <kbd>,</kbd> <kbd>.</kbd> לאט/מהר יותר</li>
          <li><kbd>r</kbd> הקראה בקול · <kbd>f</kbd> מצב ללא הסחות</li>
          <li><kbd>/</kbd> חיפוש · <kbd>s</kbd> הגדרות · <kbd>Esc</kbd> סגירה</li>
        </ul>
      </details>
    </Panel>
  )
}
