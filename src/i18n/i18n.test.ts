import { afterEach, describe, expect, it } from 'vitest'
import { en } from './en'
import { he } from './he'
import { getLocale, setLocale, t, type MessageKey } from './index'
import type { Message } from './types'

const forms = (m: Message): string[] => (typeof m === 'string' ? [m] : Object.values(m))
const placeholders = (m: Message) => new Set(forms(m).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]!)))

afterEach(() => setLocale('he'))

describe('catalogs', () => {
  const keys = Object.keys(he) as MessageKey[]

  it('English defines exactly the Hebrew keys', () => {
    expect(Object.keys(en).sort()).toEqual([...keys].sort())
  })

  it('both languages use the same placeholders for every key', () => {
    for (const key of keys) {
      // plural entries may drop `n` in a form that spells the number out ("one book")
      const a = new Set(placeholders(he[key] as Message))
      const b = new Set(placeholders(en[key]))
      a.delete('n')
      b.delete('n')
      expect([key, [...b].sort().join(',')]).toEqual([key, [...a].sort().join(',')])
    }
  })

  it('plural entries always have an "other" form', () => {
    for (const m of [...Object.values(he), ...Object.values(en)] as Message[])
      if (typeof m !== 'string') expect(m.other).toBeTruthy()
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

  it('leaves unknown placeholders alone', () => {
    expect(t('update.failed', {})).toBe('עדכון נכשל: {msg}')
  })

  it('switches the active language', () => {
    expect(getLocale()).toBe('he')
    setLocale('en')
    expect(getLocale()).toBe('en')
  })
})
