import type { ReactNode } from 'react'
import { MAX_FONT, MIN_FONT } from '../../hooks/useBookEvents'
import { CUSTOM_FONT_FAMILY, type CustomFont } from '../../lib/customFont'
import { FONTS, type Flow, type Settings, type Theme } from '../../lib/settings'
import { Panel, Seg } from './shared'
import { t } from '../../i18n'

export function SettingsPanel({
  settings,
  set,
  bump,
  customFont,
  onAllSettings,
  children,
}: {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  bump: (delta: number) => void
  customFont: CustomFont | undefined
  /** opens the full settings screen */
  onAllSettings: () => void
  /** extra sections, shown before the link to the full settings */
  children?: ReactNode
}) {
  const fontRows: [string, string, string][] = [
    ...Object.entries(FONTS).map(([k, f]): [string, string, string] => [k, f.label, f.family]),
    ...(customFont ? [['custom', customFont.name, `"${CUSTOM_FONT_FAMILY}"`] as [string, string, string]] : []),
  ]
  return (
    <Panel label={t('settings.title')} className="settings">
      <div className="row">
        <button onClick={() => bump(-2)} aria-label={t('settings.smaller')}>{t('settings.smallerGlyph')}</button>
        <input
          type="range"
          min={MIN_FONT}
          max={MAX_FONT}
          value={settings.fontSize}
          aria-label={t('settings.fontSize')}
          onChange={(e) => set('fontSize', parseInt(e.target.value))}
        />
        <button onClick={() => bump(2)} aria-label={t('settings.larger')}>{t('settings.largerGlyph')}</button>
      </div>
      <div className="row">
        <label htmlFor="lh">{t('settings.lineHeight')}</label>
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
        label={t('a11y.flow')}
        value={settings.flow}
        onChange={(v) => set('flow', v)}
        options={[['scrolled', t('settings.scrolled')], ['paginated', t('settings.paginated')]]}
      />
      <Seg<Theme>
        label={t('a11y.theme')}
        value={settings.theme}
        onChange={(v) => set('theme', v)}
        options={[['light', t('theme.light')], ['sepia', t('theme.sepia')], ['dark', t('theme.dark')], ['custom', t('theme.custom')]]}
      />
      <div className="row">
        <label htmlFor="bright">{t('settings.brightness')}</label>
        <input id="bright" type="range" min={0.3} max={1} step={0.05} value={settings.brightness} onChange={(e) => set('brightness', parseFloat(e.target.value))} />
      </div>
      <table className="fonts" aria-label={t('settings.fonts')}>
        <tbody>
          {fontRows.map(([key, label, family]) => (
            <tr key={key}>
              <td>
                <button className={key === settings.fontFamily ? 'on' : ''} aria-pressed={key === settings.fontFamily} onClick={() => set('fontFamily', key)}>
                  <span>{label}</span>
                  <span className="sample" style={family ? { fontFamily: family } : undefined}>{t('settings.sample')}</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {children}
      <button onClick={onAllSettings}>{t('prefs.allSettings')}</button>
    </Panel>
  )
}
