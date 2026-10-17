import { useState, type ReactNode } from 'react'
import { MAX_FONT, MIN_FONT } from '../../hooks/useBookEvents'
import { CUSTOM_FONT_FAMILY, removeCustomFont, saveCustomFont, type CustomFont } from '../../lib/customFont'
import { DICT_LANGS, FONTS, type Flow, type Settings, type Theme } from '../../lib/settings'
import { Select } from '../Select'
import { Panel, Seg } from './shared'
import { t } from '../../i18n'

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
      setFontError(e instanceof Error ? e.message : t('settings.fontFailed'))
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
        value={settings.flow}
        onChange={(v) => set('flow', v)}
        options={[['scrolled', t('settings.scrolled')], ['paginated', t('settings.paginated')]]}
      />
      <Seg<Theme>
        value={settings.theme}
        onChange={(v) => set('theme', v)}
        options={[['light', t('theme.light')], ['sepia', t('theme.sepia')], ['dark', t('theme.dark')], ['custom', t('theme.custom')]]}
      />
      {settings.theme === 'custom' && (
        <div className="row colors">
          <label>{t('settings.bg')} <input type="color" value={settings.customBg} onChange={(e) => set('customBg', e.target.value)} /></label>
          <label>{t('settings.fg')} <input type="color" value={settings.customFg} onChange={(e) => set('customFg', e.target.value)} /></label>
          <label>{t('settings.links')} <input type="color" value={settings.customLink} onChange={(e) => set('customLink', e.target.value)} /></label>
        </div>
      )}
      <div className="row">
        <label htmlFor="bright">{t('settings.brightness')}</label>
        <input id="bright" type="range" min={0.3} max={1} step={0.05} value={settings.brightness} onChange={(e) => set('brightness', parseFloat(e.target.value))} />
      </div>
      <div className="row">
        <label htmlFor="ls">{t('settings.letterSpacing')}</label>
        <input id="ls" type="range" min={0} max={0.2} step={0.01} value={settings.letterSpacing} onChange={(e) => set('letterSpacing', parseFloat(e.target.value))} />
      </div>
      <div className="row">
        <label htmlFor="cw">{t('settings.columnWidth')}</label>
        <input id="cw" type="range" min={320} max={1200} step={20} value={settings.columnWidth || 720} onChange={(e) => set('columnWidth', parseInt(e.target.value))} />
        <button onClick={() => set('columnWidth', 0)} aria-label={t('settings.columnAutoLabel')} disabled={!settings.columnWidth}>{t('settings.columnAuto')}</button>
      </div>
      <div className="row">
        <label htmlFor="mg">{t('settings.margins')}</label>
        <input id="mg" type="range" min={0} max={20} step={1} value={settings.margin} onChange={(e) => set('margin', parseInt(e.target.value))} />
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
      <div className="row">
        <label className="upload">
          {t('settings.uploadFont')}
          <input type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {customFont && <button onClick={() => void dropFont()}>{t('settings.removeFont')}</button>}
      </div>
      {fontError && <div role="alert" className="muted">{fontError}</div>}
      <label className="check">
        <input type="checkbox" checked={settings.justify} onChange={(e) => set('justify', e.target.checked)} />
        {t('settings.justify')}
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.accessible} onChange={(e) => set('accessible', e.target.checked)} />
        {t('settings.accessible')}
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.pageTransition} onChange={(e) => set('pageTransition', e.target.checked)} />
        {t('settings.pageAnim')}
      </label>
      <div className="check">
        {t('settings.dict')}{' '}
        <Select
          label={t('settings.dictLang')}
          value={settings.dictLang}
          onChange={(v) => set('dictLang', v)}
          options={[['auto', t('settings.dictAuto')], ...DICT_LANGS.map(([code, name]): [string, string] => [code, name])]}
        />
      </div>
      {children}
      <details className="shortcuts">
        <summary>{t('kbd.title')}</summary>
        <ul>
          <li><kbd>←</kbd> <kbd>→</kbd> <kbd>{t('kbd.space')}</kbd> {t('kbd.turnPage')}</li>
          <li><kbd>+</kbd> <kbd>-</kbd> {t('kbd.fontSize')}</li>
          <li><kbd>b</kbd> {t('kbd.bookmark')} · <kbd>[</kbd> <kbd>]</kbd> {t('kbd.bookmarkNav')}</li>
          <li><kbd>t</kbd> {t('kbd.toc')} · <kbd>n</kbd> {t('kbd.notes')}</li>
          <li><kbd>a</kbd> {t('kbd.auto')} · <kbd>,</kbd> <kbd>.</kbd> {t('kbd.pace')}</li>
          <li><kbd>r</kbd> {t('kbd.tts')} · <kbd>f</kbd> {t('kbd.focus')}</li>
          <li><kbd>/</kbd> {t('kbd.search')} · <kbd>s</kbd> {t('kbd.settings')} · <kbd>Esc</kbd> {t('kbd.close')}</li>
        </ul>
      </details>
    </Panel>
  )
}
