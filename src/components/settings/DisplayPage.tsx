import { useState } from 'react'
import { isNativeApp } from '../../lib/updater'
import { EYE_SCROLL_AVAILABLE, loadViewModes, saveViewModes, type ViewModes } from '../../lib/viewModes'
import { loadAppTheme, saveAppTheme, type AppTheme } from '../../lib/appTheme'
import { t } from '../../i18n'
import { Seg } from '../reader/shared'
import { Section, Toggle } from './parts'

/** the device-level reading modes that are chosen once; the page layout (one or two pages, screen rotation)
 *  changes with how the device is held, so it stays in the reader's Aa panel */
export function DisplayPage() {
  const [modes, setModes] = useState(loadViewModes)
  const [theme, setTheme] = useState(loadAppTheme)
  const set = <K extends keyof ViewModes>(k: K, v: ViewModes[K]) => {
    const next = { ...loadViewModes(), [k]: v }
    saveViewModes(next)
    setModes(next)
  }
  const pickTheme = (v: AppTheme) => {
    saveAppTheme(v)
    setTheme(v)
  }
  return (
    <>
      <Section title={t('prefs.appTheme')}>
        <Seg
          label={t('prefs.appTheme')}
          value={theme}
          onChange={pickTheme}
          options={[['auto', t('prefs.themeAuto')], ['light', t('theme.light')], ['dark', t('theme.dark')]]}
        />
        <small className="muted">{t('prefs.appThemeNote')}</small>
      </Section>
      <Section title={t('modes.title')}>
        {!isNativeApp && <Toggle label={t('prefs.focus')} hint={t('prefs.focusNote')} checked={modes.focus} onChange={(on) => set('focus', on)} />}
        {EYE_SCROLL_AVAILABLE && <Toggle label={t('prefs.eye')} hint={t('modes.eye')} checked={modes.eyeScroll} onChange={(on) => set('eyeScroll', on)} />}
        <small className="muted">{t('prefs.displayNote')}</small>
      </Section>
    </>
  )
}
