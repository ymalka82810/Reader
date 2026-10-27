import { describe, expect, it } from 'vitest'
import { isNight, toMinutes } from './nightMode'
import { deviceCoords, sunTimes } from './sun'

const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m)

describe('night mode', () => {
  it('reads HH:MM', () => {
    expect(toMinutes('22:30')).toBe(1350)
    expect(toMinutes('bad')).toBe(0)
  })

  it('set hours across midnight', () => {
    const s = { nightMode: 'schedule' as const, nightStart: '22:00', nightEnd: '07:00' }
    expect(isNight(s, at(23))).toBe(true)
    expect(isNight(s, at(3))).toBe(true)
    expect(isNight(s, at(7))).toBe(false)
    expect(isNight(s, at(12))).toBe(false)
  })

  it('set hours within one day, and equal hours mean never', () => {
    expect(isNight({ nightMode: 'schedule', nightStart: '13:00', nightEnd: '15:00' }, at(14))).toBe(true)
    expect(isNight({ nightMode: 'schedule', nightStart: '13:00', nightEnd: '15:00' }, at(16))).toBe(false)
    expect(isNight({ nightMode: 'schedule', nightStart: '10:00', nightEnd: '10:00' }, at(10))).toBe(false)
  })

  it('off is never night', () => {
    expect(isNight({ nightMode: 'off', nightStart: '00:00', nightEnd: '23:59' }, at(12))).toBe(false)
  })

  it('sunset to sunrise', () => {
    const s = { nightMode: 'sun' as const, nightStart: '', nightEnd: '' }
    const london: [number, number] = [51.5, -0.1]
    const noon = new Date(Date.UTC(2026, 5, 21, 12))
    const midnight = new Date(Date.UTC(2026, 5, 21, 0, 30))
    expect(isNight(s, noon, london)).toBe(false)
    expect(isNight(s, midnight, london)).toBe(true)
  })
})

describe('sun', () => {
  it('London on the summer solstice: sunrise ~03:43 UTC, sunset ~20:21 UTC', () => {
    const sun = sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 51.5, -0.1)
    if (sun.kind !== 'normal') throw new Error('expected a normal day')
    const minutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes()
    expect(Math.abs(minutes(sun.rise) - (3 * 60 + 43))).toBeLessThan(5)
    expect(Math.abs(minutes(sun.set) - (20 * 60 + 21))).toBeLessThan(5)
  })

  it('polar night and midnight sun', () => {
    expect(sunTimes(new Date(Date.UTC(2026, 11, 21, 12)), 78, 15).kind).toBe('night')
    expect(sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 78, 15).kind).toBe('day')
  })

  it('finds the place from the time zone, or guesses from the offset', () => {
    expect(deviceCoords('Asia/Jerusalem')).toEqual([31.8, 35.2])
    expect(deviceCoords('Nowhere/Unknown')[0]).toBe(35)
  })
})
