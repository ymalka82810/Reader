import { describe, expect, it } from 'vitest'
import { clear, createStore } from 'idb-keyval'
import {
  addReadingTime,
  currentStreak,
  dayKey,
  lastDays,
  loadReadingLog,
  mergeReadingLog,
  shiftDay,
  weekSummary,
} from './readingLog'

const T = '2026-03-10'

describe('days', () => {
  it('shifts across month and year boundaries', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('formats local dates', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
  })
})

describe('currentStreak', () => {
  const min = 60
  it('counts consecutive days ending today', () => {
    expect(currentStreak({ '2026-03-10': 100, '2026-03-09': 100, '2026-03-08': 100, '2026-03-06': 100 }, 0, T)).toBe(3)
  })
  it('keeps the streak alive while today has not met the target yet', () => {
    expect(currentStreak({ '2026-03-09': 100, '2026-03-08': 100 }, 0, T)).toBe(2)
    expect(currentStreak({ '2026-03-10': 10, '2026-03-09': 100 }, 0, T)).toBe(1)
  })
  it('is zero after a missed day', () => {
    expect(currentStreak({ '2026-03-08': 100 }, 0, T)).toBe(0)
  })
  it('uses the goal as the target when one is set', () => {
    const log = { '2026-03-10': 20 * min, '2026-03-09': 5 * min, '2026-03-08': 30 * min }
    expect(currentStreak(log, 20 * min, T)).toBe(1)
    expect(currentStreak(log, 5 * min, T)).toBe(3)
  })
})

describe('summaries', () => {
  it('lists the last days oldest first, filling gaps with zero', () => {
    expect(lastDays({ '2026-03-10': 5 }, 3, T)).toEqual([
      { key: '2026-03-08', secs: 0 },
      { key: '2026-03-09', secs: 0 },
      { key: '2026-03-10', secs: 5 },
    ])
  })
  it('summarises the week', () => {
    const log = { '2026-03-10': 600, '2026-03-09': 1800, '2026-03-01': 9999 }
    expect(weekSummary(log, 900, T)).toEqual({ totalSecs: 2400, activeDays: 2, goalDays: 1 })
    expect(weekSummary(log, 0, T).goalDays).toBe(0)
  })
})

describe('storage', () => {
  it('accumulates per day and merges by taking the larger side', async () => {
    await clear(createStore('reader-log-db', 'days'))
    const noon = new Date(2026, 2, 10, 12).getTime()
    await addReadingTime(30, noon)
    await addReadingTime(45, noon)
    await addReadingTime(0, noon)
    expect(await loadReadingLog()).toEqual({ '2026-03-10': 75 })

    await mergeReadingLog({ '2026-03-10': 50, '2026-03-09': 20, bad: 5, '2026-03-08': -1 })
    expect(await loadReadingLog()).toEqual({ '2026-03-10': 75, '2026-03-09': 20 })
  })
})
