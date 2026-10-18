import { t } from '../../i18n'

export type PageId = 'appearance' | 'a11y' | 'display' | 'language' | 'backup' | 'goals' | 'about'

export const PAGES: [PageId, string][] = [
  ['appearance', t('prefs.page.appearance')],
  ['a11y', t('prefs.page.a11y')],
  ['display', t('prefs.page.display')],
  ['language', t('prefs.page.language')],
  ['backup', t('prefs.page.backup')],
  ['goals', t('prefs.page.goals')],
  ['about', t('prefs.page.about')],
]
