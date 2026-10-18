import { useState } from 'react'
import { isNativeApp } from '../../lib/updater'
import { EYE_SCROLL_AVAILABLE, loadViewModes, saveViewModes, type ViewModes } from '../../lib/viewModes'
import { t } from '../../i18n'
import { Section, Toggle } from './parts'

/** the device-level reading modes that are chosen once; the page layout (one or two pages, screen rotation)
 *  changes with how the device is held, so it stays in the reader's Aa panel */
export function DisplayPage() {
  const [modes, setModes] = useState(loadViewModes)
  const set = <K extends keyof ViewModes>(k: K, v: ViewModes[K]) => {
    const next = { ...loadViewModes(), [k]: v }
    saveViewModes(next)
    setModes(next)
  }
  return (
    <Section title={t('modes.title')}>
      {!isNativeApp && <Toggle label={t('prefs.focus')} hint={t('prefs.focusNote')} checked={modes.focus} onChange={(on) => set('focus', on)} />}
      {EYE_SCROLL_AVAILABLE && <Toggle label={t('prefs.eye')} hint={t('modes.eye')} checked={modes.eyeScroll} onChange={(on) => set('eyeScroll', on)} />}
      <small className="muted">{t('prefs.displayNote')}</small>
    </Section>
  )
}
