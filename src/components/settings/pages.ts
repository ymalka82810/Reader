import { t } from '../../i18n'
import { deviceBooksSupported } from '../../lib/deviceBooks'

export type PageId = 'appearance' | 'a11y' | 'display' | 'language' | 'backup' | 'device' | 'goals' | 'about'

export const PAGES: [PageId, string][] = [
  ['appearance', t('prefs.page.appearance')],
  ['a11y', t('prefs.page.a11y')],
  ['display', t('prefs.page.display')],
  ['language', t('prefs.page.language')],
  ['backup', t('prefs.page.backup')],
  // only the Android app can read the phone's folders
  ...(deviceBooksSupported() ? [['device', t('prefs.page.device')] as [PageId, string]] : []),
  ['goals', t('prefs.page.goals')],
  ['about', t('prefs.page.about')],
]
