import { afterEach, describe, expect, it } from 'vitest'
import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { he } from './he'
import { fromDevice, getLocale, isRtl, LOCALES, setLocale, t, type Locale, type MessageKey } from './index'
import { ru } from './ru'
import type { Message } from './types'

const forms = (m: Message): string[] => (typeof m === 'string' ? [m] : Object.values(m))
const placeholders = (m: Message) => new Set(forms(m).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]!)))

afterEach(() => setLocale('he'))

const others = { en, ar, ru, fr, de, es }

describe('catalogs', () => {
  const keys = Object.keys(he) as MessageKey[]

  it.each(Object.entries(others))('%s defines exactly the Hebrew keys', (_, catalog) => {
    expect(Object.keys(catalog).sort()).toEqual([...keys].sort())
  })

  it.each(Object.entries(others))('%s uses the same placeholders as Hebrew for every key', (_, catalog) => {
    for (const key of keys) {
      // plural entries may drop `n` in a form that spells the number out ("one book")
      const a = new Set(placeholders(he[key] as Message))
      const b = new Set(placeholders(catalog[key]))
      a.delete('n')
      b.delete('n')
      expect([key, [...b].sort().join(',')]).toEqual([key, [...a].sort().join(',')])
    }
  })

  it('plural entries always have an "other" form', () => {
    for (const m of [...Object.values(he), ...Object.values(others).flatMap((c) => Object.values(c))] as Message[])
      if (typeof m !== 'string') expect(m.other).toBeTruthy()
  })

  it('every language in the picker has a catalog', () => {
    expect(LOCALES.map(([code]) => code).sort()).toEqual(['ar', 'de', 'en', 'es', 'fr', 'he', 'ru'])
  })
})

describe('device language', () => {
  it('picks the first preferred language the app has', () => {
    expect(fromDevice(['de-AT', 'en'])).toBe('de')
    expect(fromDevice(['ja', 'ru-RU', 'he'])).toBe('ru')
    expect(fromDevice(['AR-EG'])).toBe('ar')
    expect(fromDevice(['es-419'])).toBe('es')
  })

  it('maps the legacy Hebrew code and falls back to English', () => {
    expect(fromDevice(['iw'])).toBe('he')
    expect(fromDevice(['ja', 'zh-CN'])).toBe('en')
    expect(fromDevice([])).toBe('en')
  })

  it('writes right to left for Hebrew and Arabic only', () => {
    for (const [code] of LOCALES) {
      setLocale(code as Locale)
      expect(isRtl()).toBe(code === 'he' || code === 'ar')
    }
  })
})

describe('t', () => {
  it('fills placeholders', () => {
    expect(t('update.failed', { msg: 'boom' })).toBe('עדכון נכשל: boom')
    setLocale('en')
    expect(t('update.failed', { msg: 'boom' })).toBe('Update failed: boom')
  })

  it('picks the plural form by n', () => {
    expect(t('books.count', { n: 1 })).toBe('ספר אחד')
    expect(t('books.count', { n: 5 })).toBe('5 ספרים')
    setLocale('en')
    expect(t('books.count', { n: 1 })).toBe('1 book')
    expect(t('books.count', { n: 5 })).toBe('5 books')
  })

  it('picks plural forms by each language’s rules', () => {
    setLocale('ru')
    expect([1, 2, 5, 21].map((n) => t('books.count', { n }))).toEqual(['1 книга', '2 книги', '5 книг', '21 книга'])
    setLocale('ar')
    expect([1, 2, 5, 11, 100].map((n) => t('books.count', { n }))).toEqual(['كتاب واحد', 'كتابان', '5 كتب', '11 كتابًا', '100 كتاب'])
    setLocale('fr')
    expect(t('books.count', { n: 1 })).toBe('1 livre')
  })

  it('leaves unknown placeholders alone', () => {
    expect(t('update.failed', {})).toBe('עדכון נכשל: {msg}')
  })

  it('switches the active language', () => {
    expect(getLocale()).toBe('he')
    setLocale('en')
    expect(getLocale()).toBe('en')
  })
})
