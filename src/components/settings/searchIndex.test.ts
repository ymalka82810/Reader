// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { searchSettings, settingsIndex } from './searchIndex'

const find = (q: string) => searchSettings(settingsIndex(), q).map((e) => `${e.page}:${e.label}`)

describe('settings search', () => {
  it('finds a setting by part of its name, with the page it is on', () => {
    expect(find('מרווח אותיות')).toEqual(['appearance:מרווח אותיות'])
    expect(find('ניגודיות')).toEqual(['a11y:ניגודיות גבוהה'])
  })

  it('finds a page by its name, together with the settings on it', () => {
    const hits = find('גיבוי ואחסון')
    expect(hits[0]).toBe('backup:גיבוי ואחסון')
    expect(hits.length).toBeGreaterThan(3)
  })

  it('needs every word to match, in any order', () => {
    expect(find('יעד יומי')).toEqual(['goals:יעד יומי (בדקות, 0 = ללא יעד)'])
    expect(find('יומי יעד')).toHaveLength(1)
    expect(find('יומי xyz')).toEqual([])
  })

  it('returns nothing for an empty query', () => {
    expect(find('')).toEqual([])
    expect(find('   ')).toEqual([])
  })
})
