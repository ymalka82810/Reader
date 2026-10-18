import type { Settings } from '../../lib/settings'
import type { SetSetting } from '../../hooks/useAppSettings'
import { t } from '../../i18n'
import { Section, Toggle } from './parts'

/** the accessibility modes: the interface and the book follow them */
export function AccessibilityPage({ settings, set }: { settings: Settings; set: SetSetting }) {
  return (
    <Section title={t('a11y.title')}>
      <Toggle label={t('a11y.contrast')} hint={t('a11y.contrastTip')} checked={settings.contrast} onChange={(on) => set('contrast', on)} />
      <Toggle label={t('a11y.dyslexia')} hint={t('a11y.dyslexiaTip')} checked={settings.dyslexia} onChange={(on) => set('dyslexia', on)} />
      <Toggle label={t('settings.accessible')} checked={settings.accessible} onChange={(on) => set('accessible', on)} />
    </Section>
  )
}
