import { t, type MessageKey } from '../../i18n'
import { EYE_SCROLL_AVAILABLE } from '../../lib/viewModes'
import { isNativeApp } from '../../lib/updater'
import { deviceBooksSupported } from '../../lib/deviceBooks'
import { PAGES, type PageId } from './pages'

export type Entry = { page: PageId; label: string; where: string }

/** the labels of the settings on each page, which the search looks through (a page's own name always matches too) */
const ENTRIES: [PageId, MessageKey, boolean?][] = [
  ['appearance', 'settings.letterSpacing'],
  ['appearance', 'settings.columnWidth'],
  ['appearance', 'settings.margins'],
  ['appearance', 'settings.justify'],
  ['appearance', 'settings.pageAnim'],
  ['appearance', 'prefs.colorsSection'],
  ['appearance', 'prefs.fontSection'],
  ['a11y', 'a11y.contrast'],
  ['a11y', 'a11y.dyslexia'],
  ['a11y', 'settings.accessible'],
  ['display', 'prefs.appTheme'],
  ['display', 'prefs.focus', !isNativeApp],
  ['display', 'prefs.eye', EYE_SCROLL_AVAILABLE],
  ['language', 'prefs.ifaceLang'],
  ['language', 'settings.dictLang'],
  ['language', 'settings.translateLang'],
  ['language', 'prefs.privacy'],
  ['backup', 'backup.title'],
  ['backup', 'menu.restore'],
  ['backup', 'prefs.autoSection'],
  ['backup', 'prefs.reminderSection'],
  ['backup', 'prefs.storageSection'],
  ['device', 'device.auto', deviceBooksSupported()],
  ['device', 'device.bg', deviceBooksSupported()],
  ['device', 'device.renameSync', deviceBooksSupported()],
  ['device', 'device.scanNow', deviceBooksSupported()],
  ['device', 'device.retry', deviceBooksSupported()],
  ['device', 'device.folders', deviceBooksSupported()],
  ['goals', 'goals.daily'],
  ['goals', 'goals.yearly'],
  ['about', 'prefs.shortcuts'],
  ['about', 'menu.checkUpdate', isNativeApp],
]

const where = (page: PageId) => PAGES.find(([id]) => id === page)![1]

export const settingsIndex = (): Entry[] => [
  ...PAGES.map(([page, label]): Entry => ({ page, label, where: t('prefs.title') })),
  ...ENTRIES.filter(([, , shown]) => shown !== false).map(([page, key]): Entry => ({ page, label: t(key), where: where(page) })),
]

/** the entries whose label contains every word of the query */
export function searchSettings(index: Entry[], query: string): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return index.filter((e) => words.every((w) => `${e.label} ${e.where}`.toLowerCase().includes(w)))
}
