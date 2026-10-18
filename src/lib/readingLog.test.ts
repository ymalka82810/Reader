import { describe, expect, it } from 'vitest'
import { clear, createStore } from 'idb-keyval'
import {
  addReadingTime,
  currentStreak,
  dayKey,
  heatLevel,
  heatmapWeeks,
  lastDays,
  monthDays,
  loadReadingHours,
  loadReadingLog,
  mergeReadingHours,
  mergeReadingLog,
  shiftDay,
  weekDays,
  weekdayHourMatrix,
  weekSummary,
  yearProgress,
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

describe('weekDays', () => {
  it('covers Sunday to Saturday around today', () => {
    const d = weekDays({ '2026-03-08': 30 }, T) // T is a Tuesday
    expect(d.map((x) => x.key)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14'])
    expect(d[0]!.secs).toBe(30)
  })
})

describe('monthDays', () => {
  it('covers the whole calendar month, past and future days alike', () => {
    const d = monthDays({ '2026-02-03': 90, '2026-01-31': 5 }, '2026-02-10')
    expect(d).toHaveLength(28)
    expect(d[0]).toEqual({ key: '2026-02-01', secs: 0 })
    expect(d[2]).toEqual({ key: '2026-02-03', secs: 90 })
    expect(d[27]!.key).toBe('2026-02-28')
  })
})

describe('hours', () => {
  it('accumulates per hour, merges by the larger side and builds a weekday x hour matrix', async () => {
    await clear(createStore('reader-hours-db', 'hours'))
    const at = (h: number) => new Date(2026, 2, 10, h).getTime() // a Tuesday
    await addReadingTime(30, at(21))
    await addReadingTime(45, at(21))
    await addReadingTime(10, at(7))
    expect(await loadReadingHours()).toEqual({ '2026-03-10T21': 75, '2026-03-10T07': 10 })

    await mergeReadingHours({ '2026-03-10T21': 50, '2026-03-10T08': 5, bad: 9, '2026-03-10T09': -1 })
    const hours = await loadReadingHours()
    expect(hours).toEqual({ '2026-03-10T21': 75, '2026-03-10T07': 10, '2026-03-10T08': 5 })
    const m = weekdayHourMatrix(hours)
    expect(m[2]![21]).toBe(75)
    expect(m.flat().reduce((a, b) => a + b, 0)).toBe(90)
  })
})

describe('heatmap', () => {
  it('maps seconds to five shades', () => {
    expect(heatLevel(0, 100)).toBe(0)
    expect(heatLevel(1, 100)).toBe(1)
    expect(heatLevel(50, 100)).toBe(2)
    expect(heatLevel(100, 100)).toBe(4)
    expect(heatLevel(5, 0)).toBe(0)
  })
  it('lays out whole weeks ending with the current one, blanking future days', () => {
    const weeks = heatmapWeeks({ [T]: 60 }, T, 3) // T is a Tuesday
    expect(weeks).toHaveLength(3)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks[0]![0]!.key).toBe('2026-02-22')
    expect(weeks[2]![2]).toEqual({ key: T, secs: 60 })
    expect(weeks[2]![3]).toBeNull()
  })
  it('projects the year total from the pace so far', () => {
    const p = yearProgress({ '2026-01-01': 3600, '2026-01-10': 3600, '2025-12-31': 99999 }, '2026-01-10')
    expect(p.secs).toBe(7200)
    expect(p.projectedSecs).toBe(Math.round((7200 / 10) * 365))
  })
})
