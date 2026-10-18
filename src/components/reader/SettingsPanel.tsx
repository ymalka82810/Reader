import { useState, type CSSProperties, type ReactNode } from 'react'
import { MAX_FONT, MIN_FONT } from '../../hooks/useBookEvents'
import { CUSTOM_FONT_FAMILY, type CustomFont } from '../../lib/customFont'
import { FONTS, themeColors, type Flow, type Settings, type Theme } from '../../lib/settings'
import { Panel, Seg } from './shared'
import { t } from '../../i18n'

/** live sample of the reading settings, so several can be tuned together without closing the panel */
function Preview({ s, customFont }: { s: Settings; customFont: CustomFont | undefined }) {
  const c = themeColors(s)
  const a = s.accessible || s.dyslexia
  const family = s.dyslexia
    ? '"OpenDyslexic", "Heebo", "Arial", sans-serif'
    : a
      ? FONTS.sans!.family
      : s.fontFamily === 'custom' && customFont
        ? `"${CUSTOM_FONT_FAMILY}", sans-serif`
        : FONTS[s.fontFamily]?.family
  const style: CSSProperties = {
    background: c.bg,
    color: c.fg,
    fontSize: s.fontSize,
    lineHeight: a ? Math.max(s.lineHeight, 1.9) : s.lineHeight,
    letterSpacing: a ? `${Math.max(s.letterSpacing, 0.05)}em` : s.letterSpacing ? `${s.letterSpacing}em` : undefined,
    wordSpacing: a ? '0.16em' : undefined,
    textAlign: s.justify && !a ? 'justify' : 'start',
    fontFamily: family || undefined,
    maxInlineSize: s.columnWidth > 0 ? s.columnWidth : undefined,
    paddingInline: `${s.margin}%`,
    filter: s.brightness < 1 ? `brightness(${s.brightness})` : undefined,
  }
  return (
    <div className="preview" style={style} role="group" aria-label={t('settings.preview')}>
      {t('settings.previewText')}{' '}
      <a href="#preview" style={{ color: c.link }} onClick={(e) => e.preventDefault()}>{t('settings.previewLink')}</a>
    </div>
  )
}

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
  const [initial] = useState(settings)
  const keys = Object.keys(initial) as (keyof Settings)[]
  const changed = keys.some((k) => initial[k] !== settings[k])
  const revert = () => {
    for (const k of keys) if (initial[k] !== settings[k]) set(k, initial[k])
  }
  const fontRows: [string, string, string][] = [
    ...Object.entries(FONTS).map(([k, f]): [string, string, string] => [k, f.label, f.family]),
    ...(customFont ? [['custom', customFont.name, `"${CUSTOM_FONT_FAMILY}"`] as [string, string, string]] : []),
  ]
  return (
    <Panel label={t('settings.title')} className="settings">
      <div className="preview-wrap">
        <Preview s={settings} customFont={customFont} />
        <button onClick={revert} disabled={!changed}>{t('settings.revert')}</button>
      </div>
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
