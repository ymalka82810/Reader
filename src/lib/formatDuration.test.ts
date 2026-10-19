import { beforeAll, describe, expect, it } from 'vitest'
import { setLocale } from '../i18n'
import { formatDuration } from './formatDuration'

describe('formatDuration (he)', () => {
  beforeAll(() => setLocale('he'))

  it('seconds only under a minute', () => {
    expect(formatDuration(45)).toBe('45 שניות')
    expect(formatDuration(1)).toBe('שנייה')
  })
  it('minutes and seconds from a minute', () => {
    expect(formatDuration(60)).toBe('דקה')
    expect(formatDuration(427)).toBe('7 דקות ו-7 שניות')
  })
  it('hours, minutes and seconds from an hour', () => {
    expect(formatDuration(9351)).toBe('שעתיים, 35 דקות ו-51 שניות')
    expect(formatDuration(3600)).toBe('שעה')
  })
})
