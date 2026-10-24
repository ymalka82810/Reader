import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { he } from './he'
import { ru } from './ru'
import type { Message } from './types'

export type Locale = 'he' | 'en' | 'ar' | 'ru' | 'fr' | 'de' | 'es'
export type MessageKey = keyof typeof he
type Params = Record<string, string | number>

/** language name in its own language, so a speaker can always find theirs */
export const LOCALES: [Locale, string][] = [
  ['he', 'עברית'],
  ['en', 'English'],
  ['ar', 'العربية'],
  ['ru', 'Русский'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
]

const STORAGE_KEY = 'reader:lang'
const TAGS: Record<Locale, string> = { he: 'he-IL', en: 'en-US', ar: 'ar', ru: 'ru-RU', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }
const catalogs: Record<Locale, Record<MessageKey, Message>> = { he, en, ar, ru, fr, de, es }
const RTL: Locale[] = ['he', 'ar']

const isLocale = (v: string | null): v is Locale => v !== null && v in catalogs

/** the first of the device's preferred languages that the app has a catalog for (the old code `iw` is Hebrew); English otherwise */
export function fromDevice(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const code = tag.toLowerCase().split('-')[0]!
    const mapped = code === 'iw' ? 'he' : code
    if (isLocale(mapped)) return mapped
  }
  return 'en'
}

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    /* storage can be blocked */
  }
  if (typeof navigator === 'undefined') return 'en'
  return fromDevice(navigator.languages?.length ? navigator.languages : [navigator.language])
}
let locale: Locale = detect()
let plurals = new Intl.PluralRules(TAGS[locale])

/** the active UI language is fixed for a page load: switching it reloads (see changeLocale) */
export const getLocale = (): Locale => locale

/** BCP 47 tag for Intl / toLocale* calls */
export const localeTag = (): string => TAGS[locale]

export const isRtl = (): boolean => RTL.includes(locale)

/** in-memory switch, for tests and for changeLocale */
export function setLocale(next: Locale): void {
  locale = next
  plurals = new Intl.PluralRules(TAGS[next])
}

/** remember the language and reload, so every string (including module-level ones) is rebuilt */
export function changeLocale(next: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* ignore: the reload below then falls back to detection */
  }
  location.reload()
}

/** look up a message; `{name}` placeholders are filled from `params`, and plural entries are chosen by `params.n` */
export function t(key: MessageKey, params?: Params): string {
  const msg = catalogs[locale][key]
  let text: string
  if (typeof msg === 'string') text = msg
  else {
    const n = Number(params?.n ?? 0)
    text = (msg as Record<string, string | undefined>)[plurals.select(n)] ?? msg.other
  }
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text
}

/** page-level bits that live outside React: <html lang/dir> and the document title */
export function applyDocumentLocale(): void {
  const el = document.documentElement
  el.lang = locale
  el.dir = isRtl() ? 'rtl' : 'ltr'
  document.title = t('app.title')
}
